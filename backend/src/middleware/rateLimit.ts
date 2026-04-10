import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { errorResponse } from '../utils/response';
import prisma from '../config/database';

// Fallback admin emails if SystemConfig is unavailable
const DEFAULT_ADMIN_EMAILS = ['admin@docuflow.ai', 'hanhaha312@gmail.com'];

const TIER_LIMITS = {
    'FREE': 3,      // 终身3次免费
    'PLUS': 50,     // 50次/月
    'PRO': 200,     // 200次/月
    'ULTRA': 1000   // 1000次/月
};

/**
 * 限流中间件
 * FREE: 终身 3 次
 * PLUS: 每月 50 次
 * PRO: 每月 200 次
 * ULTRA: 每月 1000 次
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

        // 管理员账号不限次数 — check DB first, fallback to hardcoded list
        let adminEmails = DEFAULT_ADMIN_EMAILS;
        try {
            const config = await prisma.systemConfig.findUnique({ where: { key: 'ADMIN_EMAILS' } });
            if (config?.value) {
                adminEmails = config.value.split(',').map((e: string) => e.trim().toLowerCase());
            }
        } catch { /* SystemConfig may not exist */ }
        if (adminEmails.includes(user.email.toLowerCase())) {
            next();
            return;
        }

        const tier = user.subscriptionStatus || 'FREE';

        // 根据等级设置不同的时间范围和限制
        if (tier === 'FREE') {
            // FREE 用户：终身限制 3 次（仅计 generate_document，避免其他 actionType 误耗额度）
            const usageCount = await prisma.usageLog.count({
                where: {
                    userId: user.id,
                    actionType: 'generate_document'
                }
            });

            const limit = TIER_LIMITS['FREE'];
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
            // PRO/TEAM 用户：每月限制
            const monthStart = new Date();
            monthStart.setDate(1);
            monthStart.setHours(0, 0, 0, 0);

            const usageCount = await prisma.usageLog.count({
                where: {
                    userId: user.id,
                    actionType: 'generate_document',
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
    return DEFAULT_ADMIN_EMAILS.includes(email.toLowerCase());
};
