import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { RegisterRequest, LoginRequest } from '../types';
import { successResponse, errorResponse, isValidEmail, isValidPassword } from '../utils/response';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { authRateLimit } from '../middleware/authRateLimit';
import { AuthRequest } from '../types';
import redis from '../utils/redis';

// 限流 middleware (windowSec = 15 分钟)
const loginRateLimit = authRateLimit({ keyPrefix: 'rl:login', limit: 10, windowSec: 900 });
const registerRateLimit = authRateLimit({ keyPrefix: 'rl:register', limit: 5, windowSec: 900 });
const sendCodeRateLimit = authRateLimit({ keyPrefix: 'rl:send-code', limit: 3, windowSec: 900 });
import { sendVerificationEmail } from '../services/emailService';
import { randomInt } from 'crypto';
const svgCaptcha = require('svg-captcha');

const router = Router();

import { TIER_LIMITS } from '../config/tierConfig';
import { getUsageCount, getPeriodStart } from '../utils/usageCount';

/**
 * POST /api/auth/register
 * 用户注册
 */
router.post('/register', registerRateLimit, async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password, code }: RegisterRequest & { code?: string } = req.body;

        // 验证输入
        if (!email || !password || !code) {
            res.status(400).json(errorResponse('AUTH_MISSING_FIELDS', 400));
            return;
        }

        // Verify Email Code
        const storedCode = await redis.get(`email:code:${email}`);
        if (!storedCode || storedCode !== code) {
            res.status(400).json(errorResponse('AUTH_INVALID_CODE', 400));
            return;
        }

        if (!isValidEmail(email)) {
            res.status(400).json(errorResponse('AUTH_INVALID_EMAIL', 400));
            return;
        }

        if (!isValidPassword(password)) {
            res.status(400).json(errorResponse('AUTH_WEAK_PASSWORD', 400));
            return;
        }

        // 检查邮箱是否已存在
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            res.status(409).json(errorResponse('AUTH_EMAIL_EXISTS', 409));
            return;
        }

        // 加密密码
        const passwordHash = await bcrypt.hash(password, 10);

        // 创建用户
        const user = await prisma.user.create({
            data: {
                email,
                passwordHash,
                subscriptionStatus: 'FREE'
            },
            select: {
                id: true,
                email: true,
                subscriptionStatus: true,
                createdAt: true
            }
        });

        // Delete used code
        await redis.del(`email:code:${email}`);

        res.status(201).json(successResponse(user, '注册成功'));

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json(errorResponse('AUTH_REGISTER_FAILED', 500));
    }
});

/**
 * POST /api/auth/login
 * 用户登录
 */
router.post('/login', loginRateLimit, async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password }: LoginRequest = req.body;

        // 验证输入
        if (!email || !password) {
            res.status(400).json(errorResponse('AUTH_MISSING_CREDENTIALS', 400));
            return;
        }

        // 查找用户
        const user = await prisma.user.findUnique({
            where: { email }
        });

        if (!user) {
            res.status(401).json(errorResponse('AUTH_INVALID_CREDENTIALS', 401));
            return;
        }

        // 验证密码
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordValid) {
            res.status(401).json(errorResponse('邮箱或密码错误', 401));
            return;
        }

        // 生成 JWT token (24小时有效期)
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            throw new Error('JWT_SECRET 未配置');
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email },
            jwtSecret,
            { expiresIn: '24h', algorithm: 'HS256' }
        );

        res.json(successResponse({
            token,
            user: {
                id: user.id,
                email: user.email,
                subscriptionStatus: user.subscriptionStatus,
                subscriptionEndDate: user.subscriptionEndDate
            }
        }, '登录成功'));

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json(errorResponse('AUTH_LOGIN_FAILED', 500));
    }
});

/**
 * GET /api/auth/me
 * 获取当前用户信息 (需要认证)
 */
router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;

        if (!user) {
            res.status(401).json(errorResponse('AUTH_NOT_AUTHENTICATED', 401));
            return;
        }

        const userTier = (user.subscriptionStatus as keyof typeof TIER_LIMITS) || 'FREE';

        // Calculate Usage & Remaining Quota(带 60s Redis 缓存,DB 为真实源)
        // FREE: 终身计数;付费: 按订阅周期(quotaPeriodStart 对齐购买日,null 回落自然月)
        const periodStart = userTier === 'FREE' ? null : getPeriodStart(user.quotaPeriodStart);
        const usageCount = await getUsageCount(user.id, periodStart);

        const limit = TIER_LIMITS[userTier] || 10;
        const remainingQuota = Math.max(0, limit - usageCount);

        res.json(successResponse({
            user: {
                id: user.id,
                email: user.email,
                subscriptionStatus: user.subscriptionStatus,
                subscriptionEndDate: user.subscriptionEndDate
            },
            remainingQuota: remainingQuota
        }, '获取用户信息成功'));

    } catch (error) {
        console.error('Get user info error:', error);
        res.status(500).json(errorResponse('AUTH_FETCH_USER_FAILED', 500));
    }
});

/**
 * GET /api/auth/captcha
 * 获取图形验证码
 */
router.get('/captcha', async (_req: Request, res: Response): Promise<void> => {
    const captcha = svgCaptcha.create({
        size: 4,
        ignoreChars: '0o1i',
        noise: 2,
        color: true,
        background: '#f0f0f0',
        width: 100,
        height: 40
    });

    const sessionId = `captcha_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Store captcha text in Redis (Expire in 5 mins)
    await redis.set(`captcha:${sessionId}`, captcha.text.toLowerCase(), 'EX', 300);

    res.json(successResponse({
        image: captcha.data,
        sessionId: sessionId
    }, '获取验证码成功'));
});

/**
 * POST /api/auth/send-verify-code
 * 验证图形码并发送邮箱验证码
 */
router.post('/send-verify-code', sendCodeRateLimit, async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, captcha, sessionId } = req.body;

        if (!email || !isValidEmail(email)) {
            res.status(400).json(errorResponse('邮箱格式不正确', 400));
            return;
        }

        if (!captcha || !sessionId) {
            res.status(400).json(errorResponse('AUTH_CAPTCHA_REQUIRED', 400));
            return;
        }

        // Verify Captcha
        const storedCaptcha = await redis.get(`captcha:${sessionId}`);
        if (!storedCaptcha) {
            res.status(400).json(errorResponse('AUTH_CAPTCHA_EXPIRED', 400));
            return;
        }

        if (storedCaptcha !== captcha.toLowerCase()) {
            res.status(400).json(errorResponse('AUTH_CAPTCHA_WRONG', 400));
            return;
        }

        // Delete used captcha
        await redis.del(`captcha:${sessionId}`);

        // Rate Limit (Email): 60s cooldown
        const lastSent = await redis.get(`email:limit:${email}`);
        if (lastSent) {
            res.status(429).json(errorResponse('AUTH_RATE_LIMIT', 429));
            return;
        }

        // Check if user exists (optional, depending on flow. For register we might want to allow sending even if user exists to tell them)
        // For now, let's just send.

        // Generate Email Code
        const code = randomInt(100000, 999999).toString();

        // Send Email
        const success = await sendVerificationEmail(email, code);
        if (!success) {
            res.status(500).json(errorResponse('AUTH_EMAIL_SEND_FAILED', 500));
            return;
        }

        // Store Email Code in Redis (Expire in 10 mins)
        await redis.set(`email:code:${email}`, code, 'EX', 600);
        await redis.set(`email:limit:${email}`, '1', 'EX', 60);

        res.json(successResponse(null, '验证码已发送至您的邮箱'));

    } catch (error) {
        console.error('Send Email Code error:', error);
        res.status(500).json(errorResponse('AUTH_SEND_CODE_FAILED', 500));
    }
});

/**
 * POST /api/auth/reset-password
 * 重置密码:复用 send-verify-code 已经发到邮箱的 6 位验证码。
 * 出于安全考虑,即使邮箱不存在也返回成功 — 不向请求方泄露"哪些邮箱有账号"。
 */
router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, code, newPassword } = req.body as {
            email?: string;
            code?: string;
            newPassword?: string;
        };

        if (!email || !code || !newPassword) {
            res.status(400).json(errorResponse('AUTH_MISSING_FIELDS', 400));
            return;
        }

        if (!isValidEmail(email)) {
            res.status(400).json(errorResponse('AUTH_INVALID_EMAIL', 400));
            return;
        }

        if (!isValidPassword(newPassword)) {
            res.status(400).json(errorResponse('AUTH_WEAK_PASSWORD', 400));
            return;
        }

        // 验证邮箱验证码 (与注册流程复用同一个 Redis key)
        const storedCode = await redis.get(`email:code:${email}`);
        if (!storedCode || storedCode !== code) {
            res.status(400).json(errorResponse('AUTH_INVALID_CODE', 400));
            return;
        }

        // 查找用户 — 不存在也按"成功"处理(避免账号枚举),但实际不改任何数据
        const user = await prisma.user.findUnique({ where: { email } });

        if (user) {
            const passwordHash = await bcrypt.hash(newPassword, 12);
            await prisma.user.update({
                where: { id: user.id },
                data: { passwordHash },
            });
        }

        // 验证码用完即删
        await redis.del(`email:code:${email}`);

        res.json(successResponse(null, '密码已重置,请使用新密码登录'));
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json(errorResponse('AUTH_RESET_FAILED', 500));
    }
});

/**
 * POST /api/auth/change-password
 * 已登录用户修改密码 (验证旧密码 → 设置新密码)。
 * 旧的 JWT token 不会被强制下线,接受最多 24h 滞后。
 */
router.post('/change-password', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('AUTH_NOT_AUTHENTICATED', 401));
            return;
        }

        const { oldPassword, newPassword } = req.body as {
            oldPassword?: string;
            newPassword?: string;
        };

        if (!oldPassword || !newPassword) {
            res.status(400).json(errorResponse('AUTH_MISSING_FIELDS', 400));
            return;
        }

        if (!isValidPassword(newPassword)) {
            res.status(400).json(errorResponse('AUTH_WEAK_PASSWORD', 400));
            return;
        }

        if (oldPassword === newPassword) {
            res.status(400).json(errorResponse('AUTH_PASSWORD_UNCHANGED', 400));
            return;
        }

        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        if (!dbUser) {
            res.status(404).json(errorResponse('AUTH_USER_NOT_FOUND', 404));
            return;
        }

        const isValid = await bcrypt.compare(oldPassword, dbUser.passwordHash);
        if (!isValid) {
            res.status(401).json(errorResponse('AUTH_OLD_PASSWORD_WRONG', 401));
            return;
        }

        const newHash = await bcrypt.hash(newPassword, 12);
        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: newHash },
        });

        res.json(successResponse(null, '密码修改成功'));
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json(errorResponse('AUTH_CHANGE_PASSWORD_FAILED', 500));
    }
});

/**
 * POST /api/auth/change-email/request-code
 * 修改邮箱第一步:验证当前密码 + 校验新邮箱格式/唯一/不同当前 → 发码到"新"邮箱。
 * 注意:验证码发到"新"邮箱可防伪冒(用户必须能收到新邮箱的码)。
 */
router.post('/change-email/request-code', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('AUTH_NOT_AUTHENTICATED', 401));
            return;
        }

        const { password, newEmail } = req.body as { password?: string; newEmail?: string };
        if (!password || !newEmail) {
            res.status(400).json(errorResponse('AUTH_MISSING_FIELDS', 400));
            return;
        }

        if (!isValidEmail(newEmail)) {
            res.status(400).json(errorResponse('AUTH_INVALID_EMAIL', 400));
            return;
        }

        if (newEmail.toLowerCase() === user.email.toLowerCase()) {
            res.status(400).json(errorResponse('AUTH_EMAIL_UNCHANGED', 400));
            return;
        }

        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        if (!dbUser) {
            res.status(404).json(errorResponse('AUTH_USER_NOT_FOUND', 404));
            return;
        }

        const isValid = await bcrypt.compare(password, dbUser.passwordHash);
        if (!isValid) {
            res.status(401).json(errorResponse('AUTH_INVALID_CREDENTIALS', 401));
            return;
        }

        // 新邮箱不能已被注册
        const existing = await prisma.user.findUnique({ where: { email: newEmail } });
        if (existing) {
            res.status(409).json(errorResponse('AUTH_EMAIL_EXISTS', 409));
            return;
        }

        // 60s 节流(同一用户)
        const throttleKey = `email:change:throttle:${user.id}`;
        if (await redis.get(throttleKey)) {
            res.status(429).json(errorResponse('AUTH_RATE_LIMIT', 429));
            return;
        }

        const code = randomInt(100000, 999999).toString();
        const success = await sendVerificationEmail(newEmail, code);
        if (!success) {
            res.status(500).json(errorResponse('AUTH_EMAIL_SEND_FAILED', 500));
            return;
        }

        // 把"新邮箱 + 验证码"绑定到 userId, 10 min 内有效
        await redis.set(`email:change:${user.id}`, `${newEmail}:${code}`, 'EX', 600);
        await redis.set(throttleKey, '1', 'EX', 60);

        res.json(successResponse(null, '验证码已发送到新邮箱'));
    } catch (error) {
        console.error('Change email request error:', error);
        res.status(500).json(errorResponse('AUTH_CHANGE_EMAIL_FAILED', 500));
    }
});

/**
 * POST /api/auth/change-email/confirm
 * 修改邮箱第二步:输入新邮箱收到的验证码,校验通过后切换邮箱。
 */
router.post('/change-email/confirm', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('AUTH_NOT_AUTHENTICATED', 401));
            return;
        }

        const { code } = req.body as { code?: string };
        if (!code) {
            res.status(400).json(errorResponse('AUTH_MISSING_FIELDS', 400));
            return;
        }

        const stored = await redis.get(`email:change:${user.id}`);
        if (!stored) {
            res.status(400).json(errorResponse('AUTH_INVALID_CODE', 400));
            return;
        }

        const sepIdx = stored.lastIndexOf(':');
        if (sepIdx < 0) {
            res.status(400).json(errorResponse('AUTH_INVALID_CODE', 400));
            return;
        }
        const newEmail = stored.substring(0, sepIdx);
        const expectedCode = stored.substring(sepIdx + 1);

        if (code !== expectedCode) {
            res.status(400).json(errorResponse('AUTH_INVALID_CODE', 400));
            return;
        }

        try {
            await prisma.user.update({
                where: { id: user.id },
                data: { email: newEmail },
            });
        } catch (err: unknown) {
            // P2002 unique constraint violation (新邮箱在 request-code 和 confirm 之间被其他人注册了)
            if ((err as { code?: string }).code === 'P2002') {
                res.status(409).json(errorResponse('AUTH_EMAIL_EXISTS', 409));
                return;
            }
            throw err;
        }

        await redis.del(`email:change:${user.id}`);
        res.json(successResponse({ email: newEmail }, '邮箱已更新'));
    } catch (error) {
        console.error('Change email confirm error:', error);
        res.status(500).json(errorResponse('AUTH_CHANGE_EMAIL_FAILED', 500));
    }
});

/**
 * DELETE /api/auth/account
 * 删除账号:验证密码 + 输入 "DELETE" 字面量确认 → Cascade 清空 Document/Order/UsageLog
 * + Redis banned key 24h 防 JWT 残留。
 */
router.delete('/account', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('AUTH_NOT_AUTHENTICATED', 401));
            return;
        }

        const { password, confirm } = req.body as { password?: string; confirm?: string };
        if (!password || confirm !== 'DELETE') {
            res.status(400).json(errorResponse('AUTH_DELETE_NOT_CONFIRMED', 400));
            return;
        }

        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        if (!dbUser) {
            res.status(404).json(errorResponse('AUTH_USER_NOT_FOUND', 404));
            return;
        }

        const isValid = await bcrypt.compare(password, dbUser.passwordHash);
        if (!isValid) {
            res.status(401).json(errorResponse('AUTH_INVALID_CREDENTIALS', 401));
            return;
        }

        // 标记 banned 24h (与 JWT 有效期匹配),防止删除后旧 token 残留访问其他端点
        await redis.set(`banned:${user.id}`, '1', 'EX', 86400);

        // Cascade 清空相关表 (schema 已设 onDelete: Cascade)
        await prisma.user.delete({ where: { id: user.id } });

        res.json(successResponse(null, '账号已删除'));
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json(errorResponse('AUTH_DELETE_ACCOUNT_FAILED', 500));
    }
});

export default router;
