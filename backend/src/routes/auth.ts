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
import { isAdmin } from '../utils/admin';

const svgCaptcha = require('svg-captcha');

const router = Router();

// 限流 middleware (windowSec = 15 分钟)
const loginRateLimit = authRateLimit({ keyPrefix: 'rl:login', limit: 10, windowSec: 900 });
const smsCodeRateLimit = authRateLimit({ keyPrefix: 'rl:send-sms', limit: 5, windowSec: 900 });

const SMS_CODE_TTL = 300; // 短信验证码有效期 5 分钟
const SMS_THROTTLE = 60; // 同一手机号发码节流 60s
const MAX_CODE_ATTEMPTS = 5; // 验证码最大尝试次数

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
        const { phone, code } = req.body as { phone?: string; code?: string };
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
        if (!user) {
            user = await prisma.user.create({
                data: { phone, subscriptionStatus: 'FREE' },
            });
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

        const userTier = (user.subscriptionStatus as keyof typeof TIER_LIMITS) || 'FREE';
        const periodStart = userTier === 'FREE' ? null : getPeriodStart(user.quotaPeriodStart);
        const usageCount = await getUsageCount(user.id, periodStart);
        const limit = TIER_LIMITS[userTier] || 10;
        const remainingQuota = Math.max(0, limit - usageCount);

        res.json(successResponse({
            user: {
                id: user.id,
                phone: user.phone,
                email: user.email,
                isAdmin: await isAdmin(user.phone),
                subscriptionStatus: user.subscriptionStatus,
                subscriptionEndDate: user.subscriptionEndDate,
            },
            remainingQuota,
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

export default router;
