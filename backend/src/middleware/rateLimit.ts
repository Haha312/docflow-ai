import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { errorResponse } from '../utils/response';
import prisma from '../config/database';

// 管理员邮箱（唯一可访问后台的账号）
const ADMIN_EMAIL = 'admin@docuflow.ai';

// 各等级月度配额
const TIER_LIMITS = {
    'FREE': 3,      // 3次/日
    'PRO': 50,      // 50次/月
    'TEAM': 500     // 500次/月
};

/**
 * 限流中间件
 * FREE: 每日 3 次
 * PRO: 每月 50 次
 * TEAM: 每月 500 次
 * ADMIN: 无限制
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

        // 管理员账号不限次数
        if (user.email === ADMIN_EMAIL) {
            next();
            return;
        }

        const tier = user.subscriptionStatus || 'FREE';

        // 根据等级设置不同的时间范围和限制
        if (tier === 'FREE') {
            // FREE 用户：每日限制
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const usageCount = await prisma.usageLog.count({
                where: {
                    userId: user.id,
                    createdAt: { gte: today }
                }
            });

            const limit = TIER_LIMITS['FREE'];
            if (usageCount >= limit) {
                res.status(403).json(
                    errorResponse(
                        `免费用户每日限制 ${limit} 次，您今日已达上限。升级 Pro 获取更多额度。`,
                        403
                    )
                );
                return;
            }
            res.locals.remainingQuota = limit - usageCount;
        } else {
            // PRO/TEAM 用户：每月限制
            const monthStart = new Date();
            monthStart.setDate(1);
            monthStart.setHours(0, 0, 0, 0);

            const usageCount = await prisma.usageLog.count({
                where: {
                    userId: user.id,
                    createdAt: { gte: monthStart }
                }
            });

            const limit = TIER_LIMITS[tier as keyof typeof TIER_LIMITS] || 50;
            if (usageCount >= limit) {
                res.status(403).json(
                    errorResponse(
                        `本月使用次数已达上限 (${limit} 次)。下月 1 日重置，或升级获取更多额度。`,
                        403
                    )
                );
                return;
            }
            res.locals.remainingQuota = limit - usageCount;
        }

        next();

    } catch (error) {
        console.error('Rate limit check error:', error);
        res.status(500).json(errorResponse('限流检查失败', 500));
    }
};

/**
 * 检查是否为管理员
 */
export const isAdmin = (email: string): boolean => {
    return email === ADMIN_EMAIL;
};
