import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import { referralStats } from '../utils/referral';

const router = Router();

/**
 * GET /api/referral —— 当前用户的邀请数据:邀请码、邀请链接、已邀人数、已得次数、规则。
 * 邀请码在首次访问时惰性生成,不给从没打开过邀请页的用户占用码位。
 */
router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const stats = await referralStats(req.user!.id);
        const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
        res.json(successResponse({ ...stats, link: `${base}/?ref=${stats.code}` }));
    } catch (error) {
        console.error('[referral] 读取邀请数据失败:', error);
        res.status(500).json(errorResponse('读取邀请数据失败', 500));
    }
});

export default router;
