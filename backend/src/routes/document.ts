import { Router, Request, Response } from 'express';
import { AuthRequest } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import { authenticate } from '../middleware/auth';
import prisma from '../config/database';
import crypto from 'crypto';

const router = Router();

// 保存文档
router.post('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user!.id;
        const { title, content, preset, wordCount } = req.body;

        if (!title || !content) {
            res.status(400).json(errorResponse('标题和内容不能为空', 400));
            return;
        }

        const document = await prisma.document.create({
            data: {
                userId,
                title,
                content,
                preset: preset || 'unknown',
                wordCount: wordCount || 0
            }
        });

        res.status(201).json(successResponse(document));
    } catch (error) {
        console.error('保存文档失败:', error);
        res.status(500).json(errorResponse('保存文档失败', 500));
    }
});

// 获取文档列表
router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user!.id;
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = parseInt(req.query.pageSize as string) || 20;
        const skip = (page - 1) * pageSize;

        const [documents, total] = await prisma.$transaction([
            prisma.document.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: pageSize,
                select: {
                    id: true,
                    title: true,
                    preset: true,
                    wordCount: true,
                    createdAt: true
                }
            }),
            prisma.document.count({ where: { userId } })
        ]);

        res.json(successResponse({
            list: documents,
            pagination: {
                total,
                page,
                pageSize,
                totalPages: Math.ceil(total / pageSize)
            }
        }));
    } catch (error) {
        console.error('获取文档列表失败:', error);
        res.status(500).json(errorResponse('获取文档列表失败', 500));
    }
});

// 获取特定文档详情
router.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user!.id;
        const id = String(req.params.id || '');

        const document = await prisma.document.findUnique({
            where: { id }
        });

        if (!document) {
            res.status(404).json(errorResponse('文档不存在', 404));
            return;
        }

        if (document.userId !== userId) {
            res.status(403).json(errorResponse('无权访问该文档', 403));
            return;
        }

        res.json(successResponse(document));
    } catch (error) {
        console.error('获取文档详情失败:', error);
        res.status(500).json(errorResponse('获取文档详情失败', 500));
    }
});

// 更新文档 (用户编辑保存)
router.put('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user!.id;
        const id = String(req.params.id || '');
        const { title, content, preset, wordCount } = req.body as {
            title?: string;
            content?: string;
            preset?: string;
            wordCount?: number;
        };

        // 至少要传一个字段
        if (title === undefined && content === undefined && preset === undefined && wordCount === undefined) {
            res.status(400).json(errorResponse('至少需要更新一个字段', 400));
            return;
        }

        const existing = await prisma.document.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json(errorResponse('文档不存在', 404));
            return;
        }
        if (existing.userId !== userId) {
            res.status(403).json(errorResponse('无权修改该文档', 403));
            return;
        }

        const updated = await prisma.document.update({
            where: { id },
            data: {
                ...(title !== undefined && { title }),
                ...(content !== undefined && { content }),
                ...(preset !== undefined && { preset }),
                ...(wordCount !== undefined && { wordCount }),
            },
        });

        res.json(successResponse(updated));
    } catch (error) {
        console.error('更新文档失败:', error);
        res.status(500).json(errorResponse('更新文档失败', 500));
    }
});

// 删除文档
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user!.id;
        const id = String(req.params.id || '');

        const document = await prisma.document.findUnique({
            where: { id }
        });

        if (!document) {
            res.status(404).json(errorResponse('文档不存在', 404));
            return;
        }

        if (document.userId !== userId) {
            res.status(403).json(errorResponse('无权删除该文档', 403));
            return;
        }

        await prisma.document.delete({
            where: { id }
        });

        res.json(successResponse({ success: true }));
    } catch (error) {
        console.error('删除文档失败:', error);
        res.status(500).json(errorResponse('删除文档失败', 500));
    }
});

/**
 * POST /api/documents/:id/share
 * 为已保存的文档生成唯一只读分享链接 token。
 * 幂等:已有 token 则返回现有的,不会重置。
 * 只有文档所有者才能生成分享链接。
 */
router.post('/:id/share', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user!.id;
        const id = String(req.params.id || '');

        const document = await prisma.document.findUnique({ where: { id } });
        if (!document) {
            res.status(404).json(errorResponse('文档不存在', 404));
            return;
        }
        if (document.userId !== userId) {
            res.status(403).json(errorResponse('无权分享该文档', 403));
            return;
        }

        // 已有 token 则复用
        if (document.shareToken) {
            res.json(successResponse({ shareToken: document.shareToken }));
            return;
        }

        const shareToken = crypto.randomBytes(20).toString('base64url');
        await prisma.document.update({ where: { id }, data: { shareToken } });
        res.json(successResponse({ shareToken }));
    } catch (error) {
        console.error('创建分享链接失败:', error);
        res.status(500).json(errorResponse('创建分享链接失败', 500));
    }
});

/**
 * DELETE /api/documents/:id/share
 * 撤销分享链接(清空 shareToken)。只有文档所有者才能操作。
 */
router.delete('/:id/share', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const userId = req.user!.id;
        const id = String(req.params.id || '');

        const document = await prisma.document.findUnique({ where: { id } });
        if (!document) {
            res.status(404).json(errorResponse('文档不存在', 404));
            return;
        }
        if (document.userId !== userId) {
            res.status(403).json(errorResponse('无权操作该文档', 403));
            return;
        }

        await prisma.document.update({ where: { id }, data: { shareToken: null } });
        res.json(successResponse({ ok: true }));
    } catch (error) {
        console.error('撤销分享链接失败:', error);
        res.status(500).json(errorResponse('撤销分享链接失败', 500));
    }
});

/**
 * GET /api/share/:token
 * 公开只读接口 — 任何人持 token 即可访问。不需要 Auth。
 * 只返回展示所需字段,不返回 userId 等私密信息。
 */
router.get('/share/:token', async (req: Request, res: Response): Promise<void> => {
    try {
        const shareToken = String(req.params.token || '');
        if (!shareToken) {
            res.status(400).json(errorResponse('无效的分享链接', 400));
            return;
        }

        const document = await prisma.document.findUnique({
            where: { shareToken },
            select: { id: true, title: true, content: true, preset: true, wordCount: true, createdAt: true }
        });

        if (!document) {
            res.status(404).json(errorResponse('分享链接已失效或不存在', 404));
            return;
        }

        res.json(successResponse(document));
    } catch (error) {
        console.error('访问分享文档失败:', error);
        res.status(500).json(errorResponse('访问分享文档失败', 500));
    }
});

export default router;
