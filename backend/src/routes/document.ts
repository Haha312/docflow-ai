import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import { authenticate } from '../middleware/auth';
import prisma from '../config/database';

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

export default router;
