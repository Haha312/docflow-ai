import express, { Response } from 'express';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { getAdminEmails } from '../utils/adminEmails';

const router = express.Router();

const requireAdmin = async (req: AuthRequest, res: Response, next: express.NextFunction) => {
    try {
        const adminEmails = await getAdminEmails();
        if (!req.user || !adminEmails.includes(req.user.email.toLowerCase())) {
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

        // 1. Total Token Usage Today
        const todayUsage = await prisma.usageLog.aggregate({
            _sum: { tokenUsage: true },
            _count: { id: true },
            where: {
                createdAt: { gte: today }
            }
        });

        // 2. Total Token Usage All Time
        const totalUsage = await prisma.usageLog.aggregate({
            _sum: { tokenUsage: true },
            _count: { id: true }
        });

        // 3. Recent Logs (Last 50) with more details
        const recentLogs = await prisma.usageLog.findMany({
            take: 50,
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { email: true, subscriptionStatus: true } } }
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
            _count: { id: true },
            _sum: { tokenUsage: true }
        });

        // 6. Active Users Today
        const activeUsersToday = await prisma.usageLog.findMany({
            where: { createdAt: { gte: today } },
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
                include: { user: { select: { email: true, subscriptionStatus: true } } }
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
            email: { contains: search } // PostgreSQL implicitly case-sensitive generally, but depends on collation. Using standard contains.
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

        // getting total usage logs count per user is easier through aggregate
        const enrichedUsers = await Promise.all(users.map(async u => {
            const usageCount = await prisma.usageLog.count({ where: { userId: u.id } });
            return {
                id: u.id,
                email: u.email,
                subscriptionStatus: u.subscriptionStatus,
                subscriptionEndDate: u.subscriptionEndDate,
                createdAt: u.createdAt,
                usageCount
            };
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

export default router;
