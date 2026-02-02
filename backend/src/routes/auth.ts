import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { RegisterRequest, LoginRequest } from '../types';
import { successResponse, errorResponse, isValidEmail, isValidPassword } from '../utils/response';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Tier Configuration (MUST MATCH generate.ts)
const TIER_LIMITS = {
    'FREE': 3,
    'PRO': 30,
    'PRO_PLUS': 100,
    'ULTRA': 300
};

/**
 * POST /api/auth/register
 * 用户注册
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password }: RegisterRequest = req.body;

        // 验证输入
        if (!email || !password) {
            res.status(400).json(errorResponse('邮箱和密码不能为空', 400));
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

        // Calculate Monthly Usage & Remaining Quota
        const currentMonthStart = new Date();
        currentMonthStart.setDate(1);
        currentMonthStart.setHours(0, 0, 0, 0);

        const usageCount = await prisma.usageLog.count({
            where: {
                userId: user.id,
                actionType: 'generate_document',
                createdAt: {
                    gte: currentMonthStart
                }
            }
        });

        const userTier = (user.subscriptionStatus as keyof typeof TIER_LIMITS) || 'FREE';
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

export default router;
