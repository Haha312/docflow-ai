import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, JwtPayload } from '../types';
import { errorResponse } from '../utils/response';
import prisma from '../config/database';

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
            res.status(401).json(errorResponse('未提供认证令牌', 401));
            return;
        }

        const token = authHeader.substring(7); // 移除 "Bearer " 前缀

        // 验证 JWT
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            throw new Error('JWT_SECRET 未配置');
        }

        const decoded = jwt.verify(token, jwtSecret) as JwtPayload;

        // 从数据库获取用户信息
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: {
                id: true,
                email: true,
                subscriptionStatus: true,
                subscriptionEndDate: true
            }
        });

        if (!user) {
            res.status(401).json(errorResponse('用户不存在', 401));
            return;
        }

        // 检查 PRO 会员是否过期
        if (user.subscriptionStatus === 'PRO' && user.subscriptionEndDate) {
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
            res.status(401).json(errorResponse('无效的认证令牌', 401));
        } else if (error instanceof jwt.TokenExpiredError) {
            res.status(401).json(errorResponse('认证令牌已过期', 401));
        } else {
            console.error('Authentication error:', error);
            res.status(500).json(errorResponse('认证失败', 500));
        }
    }
};
