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

/**
 * POST /api/user/cancel-subscription
 * 取消订阅。本项目采用一次性买断模式(非自动续费),所以"取消"语义为:
 *   立即把账号降级为 FREE,放弃剩余天数的会员权益。
 * 退款剩余天数请走人工客服流程(避免自动退款被滥用)。
 */
router.post('/cancel-subscription', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, subscriptionStatus: true, subscriptionEndDate: true }
        });

        if (!user) {
            res.status(404).json(errorResponse('用户不存在', 404));
            return;
        }

        if (user.subscriptionStatus === 'FREE') {
            res.status(400).json(errorResponse('当前并非付费会员', 400));
            return;
        }

        const previousTier = user.subscriptionStatus;
        const previousEnd = user.subscriptionEndDate;

        // 原子降级
        await prisma.user.update({
            where: { id: userId },
            data: { subscriptionStatus: 'FREE', subscriptionEndDate: null }
        });

        // 记录取消事件,便于后续人工对账退款
        await prisma.usageLog.create({
            data: {
                userId,
                actionType: 'cancel_subscription',
                presetUsed: `${previousTier}|until_${previousEnd?.toISOString() || 'unknown'}`,
            }
        });

        res.json(successResponse(
            { ok: true, previousTier, previousEndDate: previousEnd },
            '订阅已取消,账号已降级为免费版。如需退款剩余天数请联系客服。'
        ));
    } catch (error) {
        console.error('取消订阅失败:', error);
        res.status(500).json(errorResponse('取消订阅失败', 500));
    }
});

export default router;
