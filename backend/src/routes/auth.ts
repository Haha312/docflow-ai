import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { RegisterRequest, LoginRequest } from '../types';
import { successResponse, errorResponse, isValidEmail, isValidPassword } from '../utils/response';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import redis from '../utils/redis';
import { sendVerificationEmail } from '../services/emailService';
import { randomInt } from 'crypto';
const svgCaptcha = require('svg-captcha');

const router = Router();

const TIER_LIMITS = {
    'FREE': 3,      // 终身3次免费
    'PLUS': 50,     // 50次/月
    'PRO': 200,     // 200次/月
    'ULTRA': 1000   // 1000次/月
};

/**
 * POST /api/auth/register
 * 用户注册
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password, code }: RegisterRequest & { code?: string } = req.body;

        // 验证输入
        if (!email || !password || !code) {
            res.status(400).json(errorResponse('邮箱、密码和验证码不能为空', 400));
            return;
        }

        // Verify Email Code
        const storedCode = await redis.get(`email:code:${email}`);
        if (!storedCode || storedCode !== code) {
            res.status(400).json(errorResponse('验证码错误或已过期', 400));
            return;
        }

        if (!isValidEmail(email)) {
            res.status(400).json(errorResponse('邮箱格式不正确', 400));
            return;
        }

        if (!isValidPassword(password)) {
            res.status(400).json(errorResponse('密码至少需要 6 位字符', 400));
            return;
        }

        // 检查邮箱是否已存在
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            res.status(409).json(errorResponse('该邮箱已被注册', 409));
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
        res.status(500).json(errorResponse('注册失败,请稍后重试', 500));
    }
});

/**
 * POST /api/auth/login
 * 用户登录
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password }: LoginRequest = req.body;

        // 验证输入
        if (!email || !password) {
            res.status(400).json(errorResponse('邮箱和密码不能为空', 400));
            return;
        }

        // 查找用户
        const user = await prisma.user.findUnique({
            where: { email }
        });

        if (!user) {
            res.status(401).json(errorResponse('邮箱或密码错误', 401));
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
            { expiresIn: '24h' }
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
        res.status(500).json(errorResponse('登录失败,请稍后重试', 500));
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
            res.status(401).json(errorResponse('未认证', 401));
            return;
        }

        const userTier = (user.subscriptionStatus as keyof typeof TIER_LIMITS) || 'FREE';

        // Calculate Usage & Remaining Quota
        let usageCount = 0;

        if (userTier === 'FREE') {
            // 免费用户：无论何时，只计算总数
            usageCount = await prisma.usageLog.count({
                where: {
                    userId: user.id,
                    actionType: 'generate_document'
                }
            });
        } else {
            // 付费用户：按自然月计算
            const currentMonthStart = new Date();
            currentMonthStart.setDate(1);
            currentMonthStart.setHours(0, 0, 0, 0);

            usageCount = await prisma.usageLog.count({
                where: {
                    userId: user.id,
                    actionType: 'generate_document',
                    createdAt: {
                        gte: currentMonthStart
                    }
                }
            });
        }

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
        res.status(500).json(errorResponse('获取用户信息失败', 500));
    }
});

/**
 * GET /api/auth/captcha
 * 获取图形验证码
 */
router.get('/captcha', async (req: Request, res: Response): Promise<void> => {
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
router.post('/send-verify-code', async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, captcha, sessionId } = req.body;

        if (!email || !isValidEmail(email)) {
            res.status(400).json(errorResponse('邮箱格式不正确', 400));
            return;
        }

        if (!captcha || !sessionId) {
            res.status(400).json(errorResponse('请输入图形验证码', 400));
            return;
        }

        // Verify Captcha
        const storedCaptcha = await redis.get(`captcha:${sessionId}`);
        if (!storedCaptcha) {
            res.status(400).json(errorResponse('图形验证码已过期，请刷新', 400));
            return;
        }

        if (storedCaptcha !== captcha.toLowerCase()) {
            res.status(400).json(errorResponse('图形验证码错误', 400));
            return;
        }

        // Delete used captcha
        await redis.del(`captcha:${sessionId}`);

        // Rate Limit (Email): 60s cooldown
        const lastSent = await redis.get(`email:limit:${email}`);
        if (lastSent) {
            res.status(429).json(errorResponse('发送太频繁，请稍后再试', 429));
            return;
        }

        // Check if user exists (optional, depending on flow. For register we might want to allow sending even if user exists to tell them)
        // For now, let's just send.

        // Generate Email Code
        const code = randomInt(100000, 999999).toString();

        // Send Email
        const success = await sendVerificationEmail(email, code);
        if (!success) {
            res.status(500).json(errorResponse('邮件发送失败，请稍后重试', 500));
            return;
        }

        // Store Email Code in Redis (Expire in 10 mins)
        await redis.set(`email:code:${email}`, code, 'EX', 600);
        await redis.set(`email:limit:${email}`, '1', 'EX', 60);

        res.json(successResponse(null, '验证码已发送至您的邮箱'));

    } catch (error) {
        console.error('Send Email Code error:', error);
        res.status(500).json(errorResponse('发送失败', 500));
    }
});

export default router;
