import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, JwtPayload } from '../types';
import { errorResponse } from '../utils/response';
import prisma from '../config/database';
import redis from '../utils/redis';

/**
 * JWT 认证中间件
 * 验证请求头中的 token,并将用户信息附加到 request 对象
 */
export const authenticate = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        // 从 Authorization header 获取 token
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json(errorResponse('AUTH_NO_TOKEN', 401));
            return;
        }

        const token = authHeader.substring(7); // 移除 "Bearer " 前缀

        // 验证 JWT
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            throw new Error('JWT_SECRET 未配置');
        }

        const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }) as JwtPayload;

        // 检查 token 是否已被吊销(账号删除后 Redis 标 banned 24h)。
        // Redis 不可用时 fail-open(放行 + 记 warn):banned 只是 24h 软约束,
        // 不应因 Redis 抖动让所有登录态用户全站 500。
        try {
            const banned = await redis.get(`banned:${decoded.userId}`);
            if (banned) {
                res.status(401).json(errorResponse('AUTH_INVALID_TOKEN', 401));
                return;
            }
        } catch (redisErr) {
            console.warn('[auth] redis banned check failed (fail-open):', (redisErr as Error).message);
        }

        // 从数据库获取用户信息
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: {
                id: true,
                phone: true,
                email: true,
                tokenVersion: true,
                subscriptionStatus: true,
                subscriptionEndDate: true,
                quotaPeriodStart: true
            }
        });

        if (!user) {
            res.status(401).json(errorResponse('AUTH_USER_NOT_FOUND', 401));
            return;
        }

        // tokenVersion 不匹配 → 旧 token 已失效(改手机/强制下线后立即生效)
        if (typeof decoded.tokenVersion === 'number' && decoded.tokenVersion !== user.tokenVersion) {
            res.status(401).json(errorResponse('AUTH_TOKEN_REVOKED', 401));
            return;
        }

        // 检查付费会员是否过期 (PLUS, PRO, ULTRA)
        if (user.subscriptionStatus !== 'FREE' && user.subscriptionEndDate) {
            if (new Date() > user.subscriptionEndDate) {
                // 会员已过期,降级为 FREE
                await prisma.user.update({
                    where: { id: user.id },
                    data: { subscriptionStatus: 'FREE', subscriptionEndDate: null }
                });
                user.subscriptionStatus = 'FREE';
            }
        }

        // 将用户信息附加到 request
        req.user = user;
        next();

    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            res.status(401).json(errorResponse('AUTH_INVALID_TOKEN', 401));
        } else if (error instanceof jwt.TokenExpiredError) {
            res.status(401).json(errorResponse('AUTH_TOKEN_EXPIRED', 401));
        } else {
            console.error('Authentication error:', error);
            res.status(500).json(errorResponse('AUTH_FAILED', 500));
        }
    }
};
