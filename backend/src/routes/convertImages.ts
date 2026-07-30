/**
 * EMF/WMF 矢量图转 PNG(P0:图片没还原的一半根源)。
 * docx 流程里图片全程留在客户端(占位符进出),但浏览器渲染不了 EMF/WMF ——
 * 用户看到的就是碎图标。前端解析后把这类图送来,用服务端 ImageMagick 转成 PNG 送回。
 * 只处理矢量格式(convertVectorImagesToPng 内部按魔数判定,栅格图原样跳过)。
 */
import { Router } from 'express';
import express from 'express';
import { authenticate } from '../middleware/auth';
import { convertVectorImagesToPng } from '../utils/imageUtils';

const router = Router();

router.post('/', express.json({ limit: '80mb' }), authenticate, async (req, res) => {
    try {
        const images = (req.body?.images ?? {}) as Record<string, string>;
        const keys = Object.keys(images);
        if (keys.length === 0 || keys.length > 60) {
            res.status(400).json({ error: 'INVALID_IMAGES' });
            return;
        }
        const map: Record<string, string> = { ...images };
        const r = await convertVectorImagesToPng(map, { concurrency: 3 });
        const changed: Record<string, string> = {};
        for (const k of keys) {
            if (map[k] !== images[k]) changed[k] = map[k];
        }
        console.log(`[CONVERT_IMAGES] in=${keys.length} converted=${r.converted} failed=${r.failed}`);
        res.json({ converted: r.converted, failed: r.failed, images: changed });
    } catch (e) {
        console.error('[CONVERT_IMAGES] failed:', e);
        res.status(500).json({ error: 'CONVERT_FAILED' });
    }
});

export default router;
