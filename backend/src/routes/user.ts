import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import { authenticate } from '../middleware/auth';
import prisma from '../config/database';

const router = Router();

// 获取用户订单历史
router.get('/orders', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const orders = await prisma.order.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                amount: true,
                currency: true,
                planType: true,
                status: true,
                createdAt: true
            }
        });

        // 格式化金额 (Prisma Decimal to number for JSON)
        const formattedOrders = orders.map(order => ({
            ...order,
            amount: Number(order.amount)
        }));

        res.json(successResponse(formattedOrders));
    } catch (error) {
        console.error('获取订单历史失败:', error);
        res.status(500).json(errorResponse('获取订单历史失败', 500));
    }
});

// 获取用户使用记录
router.get('/usage', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const limit = parseInt(req.query.limit as string) || 50;

        const logs = await prisma.usageLog.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: limit
        });

        res.json(successResponse(logs));
    } catch (error) {
        console.error('获取使用记录失败:', error);
        res.status(500).json(errorResponse('获取使用记录失败', 500));
    }
});

export default router;
