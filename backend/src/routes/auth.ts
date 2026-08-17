import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto, { randomInt } from 'crypto';
import { successResponse, errorResponse, isValidPhone, isValidEmail } from '../utils/response';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { authRateLimit } from '../middleware/authRateLimit';
import { AuthRequest } from '../types';
import redis from '../utils/redis';
import { sendSmsCode, isSmsConfigured } from '../services/smsService';
import { TIER_LIMITS } from '../config/tierConfig';
import { getUsageCount, getPeriodStart } from '../utils/usageCount';
import { bindReferral } from '../utils/referral';
import { isAdmin } from '../utils/admin';
import {
    getWechatConfig, isWechatLoginConfigured, signState, verifyState, buildQrUrl,
    issueTicket, consumeTicket, exchangeCodeForIdentity, findOrCreateByWechat,
} from '../utils/wechatLogin';

const svgCaptcha = require('svg-captcha');

const router = Router();

// 限流 middleware (windowSec = 15 分钟)
const loginRateLimit = authRateLimit({ keyPrefix: 'rl:login', limit: 10, windowSec: 900 });
const smsCodeRateLimit = authRateLimit({ keyPrefix: 'rl:send-sms', limit: 5, windowSec: 900 });

const SMS_CODE_TTL = 300; // 短信验证码有效期 5 分钟
const SMS_THROTTLE = 60; // 同一手机号发码节流 60s
const MAX_CODE_ATTEMPTS = 5; // 验证码最大尝试次数
// 图形验证码「按需」出示:同手机号 10 分钟内已发送满该次数后,后续发送才要求图形码(避免"上来就弹")。
const CAPTCHA_AFTER = 2;
const SMS_SENDCOUNT_TTL = 600; // 发送次数统计窗口(10 分钟)

function signToken(user: { id: string; phone: string | null; tokenVersion: number }): string {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET 未配置');
    return jwt.sign(
        { userId: user.id, phone: user.phone, tokenVersion: user.tokenVersion },
        jwtSecret,
        { expiresIn: '24h', algorithm: 'HS256' }
    );
}

/**
 * 校验短信验证码,内置尝试次数限制(防 6 位码暴力破解)。
 * - 失败累加 `sms:attempts:${phone}`,达上限即删码 + 锁定要求重发。
 * - 用 timingSafeEqual 做常量时间比较。
 */
async function checkSmsCode(phone: string, code: string): Promise<{ ok: boolean; reason?: 'expired' | 'locked' | 'wrong' }> {
    const codeKey = `sms:code:${phone}`;
    const attemptsKey = `sms:attempts:${phone}`;
    const stored = await redis.get(codeKey);
    if (!stored) return { ok: false, reason: 'expired' };

    const attempts = await redis.incr(attemptsKey);
    if (attempts === 1) await redis.expire(attemptsKey, SMS_CODE_TTL);
    if (attempts > MAX_CODE_ATTEMPTS) {
        await redis.del(codeKey);
        await redis.del(attemptsKey);
        return { ok: false, reason: 'locked' };
    }

    const a = Buffer.from(String(stored));
    const b = Buffer.from(String(code));
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!match) return { ok: false, reason: 'wrong' };

    await redis.del(codeKey);
    await redis.del(attemptsKey);
    return { ok: true };
}

/**
 * GET /api/auth/captcha — 图形验证码(发短信前的人机校验)
 */
router.get('/captcha', async (_req: Request, res: Response): Promise<void> => {
    const captcha = svgCaptcha.create({
        size: 4,
        ignoreChars: '0o1i',
        noise: 2,
        color: true,
        background: '#f0f0f0',
        width: 100,
        height: 40,
    });
    const sessionId = `captcha_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    await redis.set(`captcha:${sessionId}`, captcha.text.toLowerCase(), 'EX', 300);
    // 仅开发环境回传图形码文本,便于本地联调自动填(生产绝不返回)
    const devCaptcha = process.env.NODE_ENV !== 'production' ? captcha.text : undefined;
    res.json(successResponse({ image: captcha.data, sessionId, devCaptcha }, '获取验证码成功'));
});

/**
 * POST /api/auth/send-sms-code — 校验图形码 + 发送短信验证码
 * body: { phone, captcha, sessionId }
 */
router.post('/send-sms-code', smsCodeRateLimit, async (req: Request, res: Response): Promise<void> => {
    try {
        const { phone, captcha, sessionId } = req.body as { phone?: string; captcha?: string; sessionId?: string };

        if (!phone || !isValidPhone(phone)) {
            res.status(400).json(errorResponse('手机号格式不正确', 400));
            return;
        }
        // 图形验证码「按需」校验:同手机号近 10 分钟内已发送 >= CAPTCHA_AFTER 次才要求图形码,
        // 首次/少量发送直接放行,不弹码。前端据 AUTH_CAPTCHA_REQUIRED 决定是否出示图形码并重试。
        const sendCountKey = `sms:sendcount:${phone}`;
        const priorSends = parseInt((await redis.get(sendCountKey)) || '0', 10);
        if (priorSends >= CAPTCHA_AFTER) {
            if (!captcha || !sessionId) {
                res.status(400).json(errorResponse('AUTH_CAPTCHA_REQUIRED', 400));
                return;
            }
            const storedCaptcha = await redis.get(`captcha:${sessionId}`);
            if (!storedCaptcha) {
                res.status(400).json(errorResponse('AUTH_CAPTCHA_EXPIRED', 400));
                return;
            }
            if (storedCaptcha !== captcha.toLowerCase()) {
                res.status(400).json(errorResponse('AUTH_CAPTCHA_WRONG', 400));
                return;
            }
            await redis.del(`captcha:${sessionId}`);
        }

        // 同手机号 60s 节流
        if (await redis.get(`sms:throttle:${phone}`)) {
            res.status(429).json(errorResponse('AUTH_RATE_LIMIT', 429));
            return;
        }

        const code = randomInt(100000, 999999).toString();
        const sent = await sendSmsCode(phone, code);
        if (!sent) {
            res.status(500).json(errorResponse('AUTH_SMS_SEND_FAILED', 500));
            return;
        }

        await redis.set(`sms:code:${phone}`, code, 'EX', SMS_CODE_TTL);
        await redis.del(`sms:attempts:${phone}`); // 重置尝试计数
        await redis.set(`sms:throttle:${phone}`, '1', 'EX', SMS_THROTTLE);
        // 累计"发送次数"(10 分钟窗口)——达到阈值后后续发送才需图形码
        await redis.set(sendCountKey, String(priorSends + 1), 'EX', SMS_SENDCOUNT_TTL);

        // 仅开发环境且短信未配置(mock)时,直接回传验证码,方便本地联调(生产绝不返回)
        const devCode = (process.env.NODE_ENV !== 'production' && !isSmsConfigured()) ? code : undefined;
        res.json(successResponse({ devCode }, '验证码已发送'));
    } catch (error) {
        console.error('Send SMS code error:', error);
        res.status(500).json(errorResponse('AUTH_SEND_CODE_FAILED', 500));
    }
});

/**
 * POST /api/auth/login — 手机号 + 短信验证码登录(无密码,自动注册)
 * body: { phone, code }
 */
router.post('/login', loginRateLimit, async (req: Request, res: Response): Promise<void> => {
    try {
        const { phone, code, ref } = req.body as { phone?: string; code?: string; ref?: string };
        if (!phone || !isValidPhone(phone) || !code) {
            res.status(400).json(errorResponse('AUTH_MISSING_CREDENTIALS', 400));
            return;
        }

        const result = await checkSmsCode(phone, code);
        if (!result.ok) {
            if (result.reason === 'locked') {
                res.status(429).json(errorResponse('验证码错误次数过多,请重新获取', 429));
            } else if (result.reason === 'expired') {
                res.status(400).json(errorResponse('验证码已过期,请重新获取', 400));
            } else {
                res.status(400).json(errorResponse('AUTH_INVALID_CODE', 400));
            }
            return;
        }

        // find-or-create by phone(无密码,首次登录即注册)
        let user = await prisma.user.findUnique({ where: { phone } });
        const isNewUser = !user;
        if (!user) {
            user = await prisma.user.create({
                data: { phone, subscriptionStatus: 'FREE' },
            });
        }
        // 仅新用户绑定邀请关系;此处只登记不发奖,等他真正用起来再发
        if (isNewUser && ref) {
            const ip = (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.ip;
            await bindReferral(user.id, ref, ip);
        }

        const token = signToken(user);
        res.json(successResponse({
            token,
            user: {
                id: user.id,
                phone: user.phone,
                email: user.email,
                subscriptionStatus: user.subscriptionStatus,
                subscriptionEndDate: user.subscriptionEndDate,
            },
        }, '登录成功'));
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json(errorResponse('AUTH_LOGIN_FAILED', 500));
    }
});

/**
 * GET /api/auth/me — 当前用户信息 + 剩余额度
 */
router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('AUTH_NOT_AUTHENTICATED', 401));
            return;
        }

        const adminUser = await isAdmin(user.phone);
        const userTier = (user.subscriptionStatus as keyof typeof TIER_LIMITS) || 'FREE';
        const periodStart = userTier === 'FREE' ? null : getPeriodStart(user.quotaPeriodStart);
        const usageCount = adminUser ? 0 : await getUsageCount(user.id, periodStart);
        // 邀请奖励的次数直接并进总额度 —— 前端只显示一个总数,不做「3 + 5」的拆分展示
        const { bonusQuota } = (await prisma.user.findUnique({
            where: { id: user.id }, select: { bonusQuota: true },
        })) ?? { bonusQuota: 0 };
        const limit = (TIER_LIMITS[userTier] || 10) + bonusQuota;
        const remainingQuota = adminUser ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - usageCount);

        res.json(successResponse({
            user: {
                id: user.id,
                phone: user.phone,
                email: user.email,
                isAdmin: adminUser,
                subscriptionStatus: user.subscriptionStatus,
                subscriptionEndDate: user.subscriptionEndDate,
            },
            remainingQuota,
            quotaTotal: limit,
            bonusQuota,
        }, '获取用户信息成功'));
    } catch (error) {
        console.error('Get user info error:', error);
        res.status(500).json(errorResponse('AUTH_FETCH_USER_FAILED', 500));
    }
});

/**
 * POST /api/auth/set-email — 设置/更新选填邮箱(用于接收支付收据/续费提醒)
 * body: { email }(传空字符串/null 则清除)
 */
router.post('/set-email', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user!;
        const { email } = req.body as { email?: string | null };

        const normalized = (email || '').trim();
        if (normalized && !isValidEmail(normalized)) {
            res.status(400).json(errorResponse('AUTH_INVALID_EMAIL', 400));
            return;
        }

        try {
            await prisma.user.update({
                where: { id: user.id },
                data: { email: normalized || null },
            });
        } catch (err: unknown) {
            if ((err as { code?: string }).code === 'P2002') {
                res.status(409).json(errorResponse('AUTH_EMAIL_EXISTS', 409));
                return;
            }
            throw err;
        }
        res.json(successResponse({ email: normalized || null }, '邮箱已更新'));
    } catch (error) {
        console.error('Set email error:', error);
        res.status(500).json(errorResponse('AUTH_SET_EMAIL_FAILED', 500));
    }
});

/**
 * POST /api/auth/change-phone/send-code — 换绑手机第一步:向新手机发码
 * body: { newPhone, captcha, sessionId }
 */
router.post('/change-phone/send-code', authenticate, smsCodeRateLimit, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user!;
        const { newPhone, captcha, sessionId } = req.body as { newPhone?: string; captcha?: string; sessionId?: string };

        if (!newPhone || !isValidPhone(newPhone)) {
            res.status(400).json(errorResponse('手机号格式不正确', 400));
            return;
        }
        if (newPhone === user.phone) {
            res.status(400).json(errorResponse('AUTH_PHONE_UNCHANGED', 400));
            return;
        }
        if (!captcha || !sessionId) {
            res.status(400).json(errorResponse('AUTH_CAPTCHA_REQUIRED', 400));
            return;
        }
        const storedCaptcha = await redis.get(`captcha:${sessionId}`);
        if (!storedCaptcha || storedCaptcha !== captcha.toLowerCase()) {
            res.status(400).json(errorResponse('AUTH_CAPTCHA_WRONG', 400));
            return;
        }
        await redis.del(`captcha:${sessionId}`);

        // 新手机号不能已被占用
        const existing = await prisma.user.findUnique({ where: { phone: newPhone } });
        if (existing) {
            res.status(409).json(errorResponse('AUTH_PHONE_EXISTS', 409));
            return;
        }

        if (await redis.get(`sms:throttle:${newPhone}`)) {
            res.status(429).json(errorResponse('AUTH_RATE_LIMIT', 429));
            return;
        }

        const code = randomInt(100000, 999999).toString();
        const sent = await sendSmsCode(newPhone, code);
        if (!sent) {
            res.status(500).json(errorResponse('AUTH_SMS_SEND_FAILED', 500));
            return;
        }
        // 把"新手机号"绑定到 userId,与验证码一起存
        await redis.set(`sms:code:${newPhone}`, code, 'EX', SMS_CODE_TTL);
        await redis.del(`sms:attempts:${newPhone}`);
        await redis.set(`phone:change:${user.id}`, newPhone, 'EX', SMS_CODE_TTL);
        await redis.set(`sms:throttle:${newPhone}`, '1', 'EX', SMS_THROTTLE);

        res.json(successResponse(null, '验证码已发送到新手机号'));
    } catch (error) {
        console.error('Change phone send-code error:', error);
        res.status(500).json(errorResponse('AUTH_CHANGE_PHONE_FAILED', 500));
    }
});

/**
 * POST /api/auth/change-phone/confirm — 换绑手机第二步:校验新手机验证码并切换
 * body: { code } → 成功后 tokenVersion++ 使旧 token 失效,返回新 token
 */
router.post('/change-phone/confirm', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user!;
        const { code } = req.body as { code?: string };
        if (!code) {
            res.status(400).json(errorResponse('AUTH_MISSING_FIELDS', 400));
            return;
        }
        const newPhone = await redis.get(`phone:change:${user.id}`);
        if (!newPhone) {
            res.status(400).json(errorResponse('验证码已过期,请重新获取', 400));
            return;
        }
        const result = await checkSmsCode(newPhone, code);
        if (!result.ok) {
            res.status(400).json(errorResponse(result.reason === 'locked' ? '验证码错误次数过多,请重新获取' : 'AUTH_INVALID_CODE', result.reason === 'locked' ? 429 : 400));
            return;
        }

        let updated;
        try {
            updated = await prisma.user.update({
                where: { id: user.id },
                data: { phone: newPhone, tokenVersion: { increment: 1 } },
            });
        } catch (err: unknown) {
            if ((err as { code?: string }).code === 'P2002') {
                res.status(409).json(errorResponse('AUTH_PHONE_EXISTS', 409));
                return;
            }
            throw err;
        }
        await redis.del(`phone:change:${user.id}`);
        await redis.set(`usrver:${user.id}`, String(updated.tokenVersion), 'EX', 86400);

        // 旧 token 已随 tokenVersion 失效 → 签发新 token 保持登录态
        const token = signToken(updated);
        res.json(successResponse({ token, phone: newPhone }, '手机号已更新'));
    } catch (error) {
        console.error('Change phone confirm error:', error);
        res.status(500).json(errorResponse('AUTH_CHANGE_PHONE_FAILED', 500));
    }
});

/**
 * DELETE /api/auth/account — 删除账号(无密码:仅需输入 "DELETE" 字面量确认)
 * body: { confirm: 'DELETE' }
 */
router.delete('/account', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user!;
        const { confirm } = req.body as { confirm?: string };
        if (confirm !== 'DELETE') {
            res.status(400).json(errorResponse('AUTH_DELETE_NOT_CONFIRMED', 400));
            return;
        }
        // banned 24h 防残留 JWT;Cascade 清空 Document/Order/UsageLog
        await redis.set(`banned:${user.id}`, '1', 'EX', 86400);
        await prisma.user.delete({ where: { id: user.id } });
        res.json(successResponse(null, '账号已删除'));
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json(errorResponse('AUTH_DELETE_ACCOUNT_FAILED', 500));
    }
});

// ── 微信扫码登录 ──────────────────────────────────────────────

/** 站点对外地址。回调地址必须与开放平台配置的「授权回调域」同域 */
const publicBase = (req: Request): string =>
    process.env.PUBLIC_URL
    || process.env.BACKEND_URL
    || process.env.FRONTEND_URL
    || `${req.protocol}://${req.get('host')}`;

/** 前端首页地址:回调完成后带票跳回这里 */
const frontendBase = (req: Request): string =>
    process.env.FRONTEND_URL || publicBase(req);

/**
 * GET /api/auth/wechat/status — 前端据此决定要不要显示「微信登录」页签。
 * 没配凭据时不显示,免得用户点了一个必然失败的入口。
 */
router.get('/wechat/status', async (_req: Request, res: Response): Promise<void> => {
    res.json(successResponse({ enabled: await isWechatLoginConfigured() }));
});

/**
 * GET /api/auth/wechat/start — 取二维码页地址。
 * ?json=1 返回地址给前端内嵌 iframe(不把用户带离站点);否则 302 直跳。
 */
router.get('/wechat/start', async (req: Request, res: Response): Promise<void> => {
    try {
        const cfg = await getWechatConfig();
        const wantJson = req.query.json === '1' || req.query.json === 'true';
        if (!cfg.appid || !cfg.secret) {
            res.status(404).json(errorResponse('微信登录未配置', 404));
            return;
        }
        const ref = typeof req.query.ref === 'string' ? req.query.ref.slice(0, 16) : undefined;
        const url = buildQrUrl({
            appid: cfg.appid,
            callbackUrl: `${publicBase(req)}/api/auth/wechat/callback`,
            state: signState({ ref }),
            styleHref: `${publicBase(req)}/wxqr.css`,
        });
        if (wantJson) {
            res.json(successResponse({ url, expiresIn: 300 }));
            return;
        }
        res.redirect(url);
    } catch (error) {
        console.error('WeChat start error:', error);
        res.status(500).json(errorResponse('微信登录发起失败', 500));
    }
});

/**
 * GET /api/auth/wechat/callback — 微信扫码后回跳到这里。
 * 一律 302 回首页(带票或带错误码),不返回 JSON —— 这个地址是用户浏览器直接访问的。
 */
router.get('/wechat/callback', async (req: Request, res: Response): Promise<void> => {
    const home = frontendBase(req);
    try {
        const cfg = await getWechatConfig();
        if (!cfg.appid || !cfg.secret) { res.redirect(`${home}/?wxerr=unconfigured`); return; }

        const { code, state } = req.query as { code?: string; state?: string };
        const st = verifyState(String(state || ''));
        if (!st.ok) { res.redirect(`${home}/?wxerr=state`); return; }
        if (!code) { res.redirect(`${home}/?wxerr=nocode`); return; }

        const identity = await exchangeCodeForIdentity(String(code), cfg);
        if (!identity) { res.redirect(`${home}/?wxerr=exchange`); return; }

        const { userId, isNew } = await findOrCreateByWechat(identity);

        // 与短信登录同一口径:只有新用户登记邀请关系,且此刻只登记不发奖
        if (isNew && st.ref) {
            const ip = (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.ip;
            await bindReferral(userId, st.ref, ip);
        }

        const ticket = await issueTicket(userId);
        res.redirect(`${home}/?wxlogin=${ticket}`);
    } catch (error) {
        console.error('WeChat callback error:', error);
        res.redirect(`${home}/?wxerr=server`);
    }
});

/**
 * POST /api/auth/wechat/finish — 用一次性票换正式 JWT。
 * JWT 只走这条 POST 返回,绝不进 URL(URL 会留在浏览器历史、Referer 和访问日志里)。
 */
router.post('/wechat/finish', loginRateLimit, async (req: Request, res: Response): Promise<void> => {
    try {
        const { ticket } = req.body as { ticket?: string };
        const userId = await consumeTicket(String(ticket || ''));
        if (!userId) {
            res.status(400).json(errorResponse('登录票据无效或已过期,请重新扫码', 400));
            return;
        }
        const banned = await redis.get(`banned:${userId}`);
        if (banned) {
            res.status(403).json(errorResponse('账号已被封禁,如有疑问请联系客服', 403));
            return;
        }
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            res.status(404).json(errorResponse('用户不存在', 404));
            return;
        }
        res.json(successResponse({
            token: signToken(user),
            user: {
                id: user.id,
                phone: user.phone,
                email: user.email,
                subscriptionStatus: user.subscriptionStatus,
                subscriptionEndDate: user.subscriptionEndDate,
            },
        }, '登录成功'));
    } catch (error) {
        console.error('WeChat finish error:', error);
        res.status(500).json(errorResponse('AUTH_LOGIN_FAILED', 500));
    }
});

export default router;
