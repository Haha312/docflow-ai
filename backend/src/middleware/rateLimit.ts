import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { errorResponse } from '../utils/response';
import prisma from '../config/database';
import { isAdmin } from '../utils/admin';

const TIER_LIMITS = {
    FREE: 3,      // 终身 3 次
    PLUS: 50,     // 50 次/月
    PRO: 200,     // 200 次/月
    ULTRA: 1000,  // 1000 次/月
};

/**
 * 限流中间件
 * FREE: 终身 3 次
 * PLUS / PRO / ULTRA: 每月配额
 * 管理员(通过 SystemConfig 或 ADMIN_EMAILS 配置): 不限次数
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

        if (await isAdmin(user.email)) {
            next();
            return;
        }

        const tier = user.subscriptionStatus || 'FREE';

        if (tier === 'FREE') {
            const usageCount = await prisma.usageLog.count({
                where: {
                    userId: user.id,
                    actionType: 'generate_document',
                },
            });

            const limit = TIER_LIMITS.FREE;
            if (usageCount >= limit) {
                res.status(403).json(
                    errorResponse(
                        `免费使用额度(${limit}次)已耗尽。请升级会员获取更多额度。`,
                        403
                    )
                );
                return;
            }
            res.locals.remainingQuota = limit - usageCount;
        } else {
            const monthStart = new Date();
            monthStart.setDate(1);
            monthStart.setHours(0, 0, 0, 0);

            const usageCount = await prisma.usageLog.count({
                where: {
                    userId: user.id,
                    actionType: 'generate_document',
                    createdAt: { gte: monthStart },
                },
            });

            const limit = TIER_LIMITS[tier as keyof typeof TIER_LIMITS] || 50;
            if (usageCount >= limit) {
                res.status(403).json(
                    errorResponse(
                        `本月使用次数已达上限 (${limit} 次)。下月 1 日重置,或升级获取更多额度。`,
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

// Re-export for backwards compatibility with any consumers that imported isAdmin from this file
export { isAdmin } from '../utils/admin';
