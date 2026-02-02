import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { errorResponse } from '../utils/response';
import prisma from '../config/database';

/**
 * 限流中间件
 * 检查用户的使用额度,FREE 用户每日限制 3 次
 */
export const checkRateLimit = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const user = req.user;

        if (!user) {
            res.status(401).json(errorResponse('未认证', 401));
            return;
        }

        // PRO 用户无限制
        if (user.subscriptionStatus === 'PRO') {
            next();
            return;
        }

        // FREE 用户检查今日使用次数
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const usageCount = await prisma.usageLog.count({
            where: {
                userId: user.id,
                createdAt: {
                    gte: today
                }
            }
        });

        const DAILY_LIMIT = 3;

        if (usageCount >= DAILY_LIMIT) {
            res.status(403).json(
                errorResponse(
                    `免费用户每日限制 ${DAILY_LIMIT} 次使用,您今日已达上限。请升级到 Pro 会员以解锁无限使用。`,
                    403
                )
            );
            return;
        }

        // 在响应对象中附加剩余次数信息
        res.locals.remainingQuota = DAILY_LIMIT - usageCount;
        next();

    } catch (error) {
        console.error('Rate limit check error:', error);
        res.status(500).json(errorResponse('限流检查失败', 500));
    }
};
