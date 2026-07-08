import express, { Response } from 'express';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { isAdmin } from '../utils/admin';
import redis from '../utils/redis';

const router = express.Router();

const requireAdmin = async (req: AuthRequest, res: Response, next: express.NextFunction) => {
    try {
        if (!req.user || !(await isAdmin(req.user.phone))) {
            res.status(403).json({ error: 'Access Denied: Admins Only' });
            return;
        }
        next();
    } catch (error) {
        res.status(500).json({ error: 'Admin check failed' });
    }
};

/**
 * GET /api/admin/stats
 * Get Token Usage Statistics
 */
router.get('/stats', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const days = parseInt(req.query.days as string) || 7;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 只统计"文档生成"类日志(含低质量的 generate_document_lowquality),
        // 排除 refund_success / cancel_subscription 等非生成动作,避免污染调用量/活跃/preset 统计。
        const GEN_ONLY = { actionType: { startsWith: 'generate_document' } };

        // 1. Total Token Usage Today
        const todayUsage = await prisma.usageLog.aggregate({
            _sum: { tokenUsage: true },
            _count: { id: true },
            where: {
                ...GEN_ONLY,
                createdAt: { gte: today }
            }
        });

        // 2. Total Token Usage All Time
        const totalUsage = await prisma.usageLog.aggregate({
            _sum: { tokenUsage: true },
            _count: { id: true },
            where: { ...GEN_ONLY }
        });

        // 3. Recent Logs (Last 50) with more details
        const recentLogs = await prisma.usageLog.findMany({
            take: 50,
            where: { ...GEN_ONLY },
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { phone: true, email: true, subscriptionStatus: true } } }
        });

        // 4. Daily History (Dynamic days) for line chart
        const dailyHistory = [];
        for (let i = days - 1; i >= 0; i--) {
            const dayStart = new Date();
            dayStart.setDate(dayStart.getDate() - i);
            dayStart.setHours(0, 0, 0, 0);

            const dayEnd = new Date(dayStart);
            dayEnd.setHours(23, 59, 59, 999);

            const dayStats = await prisma.usageLog.aggregate({
                _sum: { tokenUsage: true },
                _count: { id: true },
                where: {
                    ...GEN_ONLY,
                    createdAt: {
                        gte: dayStart,
                        lte: dayEnd
                    }
                }
            });

            dailyHistory.push({
                date: dayStart.toISOString().split('T')[0],
                dateLabel: `${dayStart.getMonth() + 1}/${dayStart.getDate()}`,
                tokens: dayStats._sum.tokenUsage || 0,
                calls: dayStats._count.id || 0
            });
        }

        // 5. Preset Usage Distribution
        const presetStats = await prisma.usageLog.groupBy({
            by: ['presetUsed'],
            where: { ...GEN_ONLY },
            _count: { id: true },
            _sum: { tokenUsage: true }
        });

        // 6. Active Users Today
        const activeUsersToday = await prisma.usageLog.findMany({
            where: { ...GEN_ONLY, createdAt: { gte: today } },
            distinct: ['userId'],
            select: { userId: true }
        });

        res.json({
            today: {
                tokens: todayUsage._sum.tokenUsage || 0,
                calls: todayUsage._count.id || 0,
                activeUsers: activeUsersToday.length
            },
            total: {
                tokens: totalUsage._sum.tokenUsage || 0,
                calls: totalUsage._count.id || 0
            },
            dailyHistory,
            presetStats: presetStats.map(p => ({
                preset: p.presetUsed,
                count: p._count.id,
                tokens: p._sum.tokenUsage || 0
            })),
            recentLogs
        });
    } catch (error) {
        console.error('Admin Stats Error:', error);
        res.status(500).json({ error: 'Failed to fetch admin stats' });
    }
});

/**
 * GET /api/admin/overview
 * 营收 + 用户聚合总览(只读,纯聚合现有 Order/User,无 schema 改动)
 */
router.get('/overview', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const days = parseInt(req.query.days as string) || 7;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const periodStart = new Date();
        periodStart.setDate(periodStart.getDate() - (days - 1));
        periodStart.setHours(0, 0, 0, 0);

        // 收入按下单时间 createdAt 分桶:Order 无 paidAt 字段;updatedAt 会被退款改写,故用不可变的 createdAt
        // (即付场景下下单时间≈支付时间;若日后新增 paidAt 列可改用之)
        const [todayAgg, periodAgg, totalAgg, refundAgg] = await Promise.all([
            prisma.order.aggregate({ _sum: { amount: true }, _count: { id: true }, where: { status: 'PAID', createdAt: { gte: today } } }),
            prisma.order.aggregate({ _sum: { amount: true }, _count: { id: true }, where: { status: 'PAID', createdAt: { gte: periodStart } } }),
            prisma.order.aggregate({ _sum: { amount: true }, _count: { id: true }, where: { status: 'PAID' } }),
            prisma.order.aggregate({ _sum: { amount: true }, _count: { id: true }, where: { status: 'REFUNDED' } }),
        ]);

        // 按套餐(仅已支付)
        const byPlanRaw = await prisma.order.groupBy({
            by: ['planType'],
            where: { status: 'PAID' },
            _count: { id: true },
            _sum: { amount: true },
        });
        const byPlan = byPlanRaw
            .map(p => ({ planType: p.planType, count: p._count.id, revenue: Number(p._sum.amount ?? 0) }))
            .sort((a, b) => b.revenue - a.revenue);

        // 每日营收(近 N 天,沿用 /stats dailyHistory 写法)
        const dailyRevenue = [];
        for (let i = days - 1; i >= 0; i--) {
            const ds = new Date();
            ds.setDate(ds.getDate() - i);
            ds.setHours(0, 0, 0, 0);
            const de = new Date(ds);
            de.setHours(23, 59, 59, 999);
            const a = await prisma.order.aggregate({
                _sum: { amount: true },
                _count: { id: true },
                where: { status: 'PAID', createdAt: { gte: ds, lte: de } },
            });
            dailyRevenue.push({
                date: ds.toISOString().split('T')[0],
                dateLabel: `${ds.getMonth() + 1}/${ds.getDate()}`,
                revenue: Number(a._sum.amount ?? 0),
                orders: a._count.id || 0,
            });
        }

        // 用户聚合
        const [totalUsers, tierGroups, activePaid, newToday] = await Promise.all([
            prisma.user.count(),
            prisma.user.groupBy({ by: ['subscriptionStatus'], _count: { id: true } }),
            prisma.user.count({ where: { subscriptionStatus: { not: 'FREE' } } }),
            prisma.user.count({ where: { createdAt: { gte: today } } }),
        ]);
        const byTier: Record<string, number> = { FREE: 0, PLUS: 0, PRO: 0, ULTRA: 0 };
        tierGroups.forEach(g => { byTier[g.subscriptionStatus] = g._count.id; });
        const conversionPct = totalUsers > 0 ? Math.round((activePaid / totalUsers) * 10000) / 100 : 0;

        // 每日新增注册(近 N 天)
        const dailySignups = [];
        for (let i = days - 1; i >= 0; i--) {
            const ds = new Date();
            ds.setDate(ds.getDate() - i);
            ds.setHours(0, 0, 0, 0);
            const de = new Date(ds);
            de.setHours(23, 59, 59, 999);
            const c = await prisma.user.count({ where: { createdAt: { gte: ds, lte: de } } });
            dailySignups.push({
                date: ds.toISOString().split('T')[0],
                dateLabel: `${ds.getMonth() + 1}/${ds.getDate()}`,
                count: c,
            });
        }

        res.json({
            revenue: {
                today: { revenue: Number(todayAgg._sum.amount ?? 0), paidOrders: todayAgg._count.id || 0 },
                period: { revenue: Number(periodAgg._sum.amount ?? 0), paidOrders: periodAgg._count.id || 0 },
                total: { revenue: Number(totalAgg._sum.amount ?? 0), paidOrders: totalAgg._count.id || 0 },
            },
            refunds: { refundedAmount: Number(refundAgg._sum.amount ?? 0), refundedCount: refundAgg._count.id || 0 },
            byPlan,
            dailyRevenue,
            users: { total: totalUsers, byTier, activePaid, newToday, conversionPct },
            dailySignups,
        });
    } catch (error) {
        console.error('Admin Overview Error:', error);
        res.status(500).json({ error: 'Failed to fetch overview' });
    }
});

/**
 * GET /api/admin/orders
 * 订单列表(分页 + 可选状态过滤)
 */
router.get('/orders', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 15;
        const skip = (page - 1) * limit;
        const VALID_STATUSES = ['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDING', 'REFUNDED'];
        const status = req.query.status as string | undefined;
        // 仅当状态在枚举内才过滤;非法/缺省 = 不过滤(不报错)
        const where: any = (status && VALID_STATUSES.includes(status)) ? { status } : {};

        const [total, orders] = await Promise.all([
            prisma.order.count({ where }),
            prisma.order.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    amount: true,
                    currency: true,
                    planType: true,
                    status: true,
                    createdAt: true,
                    user: { select: { phone: true, email: true, subscriptionStatus: true } },
                },
            }),
        ]);

        res.json({
            data: orders.map(o => ({ ...o, amount: Number(o.amount) })),
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('Admin Orders Error:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

/**
 * GET /api/admin/logs
 * Get Paginated Usage Logs
 */
router.get('/logs', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;

        const [total, logs] = await Promise.all([
            prisma.usageLog.count(),
            prisma.usageLog.findMany({
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: { user: { select: { phone: true, email: true, subscriptionStatus: true } } }
            })
        ]);

        res.json({
            data: logs,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Admin Logs Error:', error);
        res.status(500).json({ error: 'Failed to fetch admin logs' });
    }
});

/**
 * GET /api/admin/users
 * Get Paginated Users
 */
router.get('/users', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const search = req.query.search as string;
        const skip = (page - 1) * limit;

        const whereClause = search ? {
            OR: [
                { phone: { contains: search } },
                { email: { contains: search } },
            ],
        } : {};

        const [total, users] = await Promise.all([
            prisma.user.count({ where: whereClause }),
            prisma.user.findMany({
                where: whereClause,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    phone: true,
                    email: true,
                    subscriptionStatus: true,
                    subscriptionEndDate: true,
                    createdAt: true,
                    usageLogs: {
                        select: { id: true } // just to eventually get count if needed, or we compute in separate query
                    }
                }
            })
        ]);

        // 批量查询 usageCount (单条 SQL groupBy 替代 N 次 count)
        const userIds = users.map(u => u.id);
        const [usageCounts, bannedStatuses] = await Promise.all([
            prisma.usageLog.groupBy({
                by: ['userId'],
                where: { userId: { in: userIds }, actionType: { startsWith: 'generate_document' } },
                _count: { id: true },
            }),
            // 批量查 Redis banned 状态 (并行,但只 1 轮 Promise.all 而非 N 轮)
            Promise.all(userIds.map(id => redis.get(`banned:${id}`))),
        ]);

        const usageMap = new Map(usageCounts.map(g => [g.userId, g._count.id]));
        const bannedMap = new Map(userIds.map((id, i) => [id, !!bannedStatuses[i]]));

        const enrichedUsers = users.map(u => ({
            id: u.id,
            phone: u.phone,
            email: u.email,
            subscriptionStatus: u.subscriptionStatus,
            subscriptionEndDate: u.subscriptionEndDate,
            createdAt: u.createdAt,
            usageCount: usageMap.get(u.id) ?? 0,
            banned: bannedMap.get(u.id) ?? false,
        }));

        res.json({
            data: enrichedUsers,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Admin Users Error:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

/**
 * POST /api/admin/users/:id
 * Update User subscription
 */
router.post('/users/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const userId = String(req.params.id || '');
        const { subscriptionStatus, additionalDays } = req.body;

        const VALID_STATUSES = ['FREE', 'PLUS', 'PRO', 'ULTRA'];
        const data: any = {};
        if (subscriptionStatus !== undefined) {
            if (!VALID_STATUSES.includes(subscriptionStatus)) {
                res.status(400).json({ error: `Invalid subscriptionStatus. Must be one of: ${VALID_STATUSES.join(', ')}` });
                return;
            }
            data.subscriptionStatus = subscriptionStatus;
        }

        if (additionalDays && typeof additionalDays === 'number') {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (user) {
                const currentEnd = user.subscriptionEndDate && user.subscriptionEndDate > new Date()
                    ? user.subscriptionEndDate
                    : new Date();
                currentEnd.setDate(currentEnd.getDate() + additionalDays);
                data.subscriptionEndDate = currentEnd;
            }
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data,
            select: { id: true, email: true, subscriptionStatus: true, subscriptionEndDate: true }
        });

        res.json({ success: true, user: updatedUser });
    } catch (error) {
        console.error('Admin Edit User Error:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

/**
 * GET /api/admin/config
 * Get System Configuration
 */
router.get('/config', authenticate, requireAdmin, async (_req: AuthRequest, res) => {
    try {
        const configs = await prisma.systemConfig.findMany();
        // Convert array to object
        const configMap: Record<string, string> = {};
        configs.forEach((c: any) => configMap[c.key] = c.value);
        res.json(configMap);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch config' });
    }
});

/**
 * POST /api/admin/config
 * Update System Configuration
 */
router.post('/config', authenticate, requireAdmin, async (req: AuthRequest, res) => {
    try {
        const { configs } = req.body; // Expect { "KEY": "VALUE", ... }

        if (!configs || typeof configs !== 'object') {
            res.status(400).json({ error: 'Invalid config format' });
            return;
        }

        const updates = Object.keys(configs).map(key =>
            prisma.systemConfig.upsert({
                where: { key },
                update: { value: String(configs[key]) },
                create: { key, value: String(configs[key]) }
            })
        );

        await prisma.$transaction(updates);
        res.json({ success: true, message: 'Configuration updated' });
    } catch (error) {
        console.error('Config Update Error:', error);
        res.status(500).json({ error: 'Failed to update config' });
    }
});

/**
 * POST /api/admin/users/:id/ban
 * 封禁用户:写 Redis banned:${userId} (无过期,持久封禁)。
 * auth middleware 会拒绝其携带的 JWT,导致所有 API 401。
 * 不删除用户数据,只阻断访问。
 */
router.post('/users/:id/ban', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const id = String(req.params.id || '');
        const target = await prisma.user.findUnique({ where: { id } });
        if (!target) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // 防止 admin 误封自己
        if (target.id === req.user!.id) {
            res.status(400).json({ error: 'Cannot ban yourself' });
            return;
        }
        // 不设过期 = 永久封禁;手动 unban 才能解
        await redis.set(`banned:${id}`, '1');
        res.json({ ok: true, banned: true });
    } catch (error) {
        console.error('Ban user failed:', error);
        res.status(500).json({ error: 'Ban failed' });
    }
});

/**
 * POST /api/admin/users/:id/unban
 * 解封用户:删除 Redis banned key。
 */
router.post('/users/:id/unban', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const id = String(req.params.id || '');
        await redis.del(`banned:${id}`);
        res.json({ ok: true, banned: false });
    } catch (error) {
        console.error('Unban user failed:', error);
        res.status(500).json({ error: 'Unban failed' });
    }
});

export default router;
