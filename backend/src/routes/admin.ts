import express, { Request, Response } from 'express';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = express.Router();

// Middleware to check for Admin Email
const requireAdmin = (req: AuthRequest, res: Response, next: express.NextFunction) => {
    if (!req.user || req.user.email !== 'admin@docuflow.ai') {
        res.status(403).json({ error: 'Access Denied: Admins Only' });
        return;
    }
    next();
};

/**
 * GET /api/admin/stats
 * Get Token Usage Statistics
 */
router.get('/stats', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
    try {
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

        // 4. Daily History (Last 7 days) for line chart
        const dailyHistory = [];
        for (let i = 6; i >= 0; i--) {
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
 * GET /api/admin/config
 * Get System Configuration
 */
router.get('/config', authenticate, requireAdmin, async (req: AuthRequest, res) => {
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
