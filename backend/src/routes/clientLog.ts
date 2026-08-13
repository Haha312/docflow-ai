import { Router, Request, Response } from 'express';

/**
 * 前端错误上报。此前线上前端出了错只能等用户截图 —— 这里收下来进 pm2 日志,
 * `pm2 logs docflow-backend | grep CLIENT_ERROR` 就能看到线上真实报错。
 *
 * 设计约束:
 *  - 不需要登录(未登录状态的报错同样要收);
 *  - 单条截断 + 每 IP 限速,防刷防灌;
 *  - 只进日志不进库:错误上报是诊断通道,不是数据资产,别给数据库添负担。
 */
const router = Router();

const MAX_FIELD = 2000;
const WINDOW_MS = 60_000;
const LIMIT_PER_WINDOW = 10;
const hits = new Map<string, { count: number; resetAt: number }>();

// 内存限速(单实例部署够用;多实例时顶多多收几条,无害)
const allow = (ip: string): boolean => {
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || now > h.resetAt) {
        hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
        return true;
    }
    h.count += 1;
    return h.count <= LIMIT_PER_WINDOW;
};
// 防 Map 无限膨胀:过期项顺手清
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
}, WINDOW_MS).unref();

router.post('/', (req: Request, res: Response): void => {
    const ip = (req.headers['x-real-ip'] as string) || req.ip || 'unknown';
    if (!allow(ip)) { res.status(429).json({ success: false }); return; }

    const s = (v: unknown): string => String(v ?? '').slice(0, MAX_FIELD);
    const { message, stack, url, userAgent, context } = (req.body ?? {}) as Record<string, unknown>;
    if (!message) { res.status(400).json({ success: false }); return; }

    console.error('[CLIENT_ERROR]', JSON.stringify({
        message: s(message),
        stack: s(stack),
        url: s(url),
        userAgent: s(userAgent),
        context: s(context),
        ip,
        at: new Date().toISOString(),
    }));
    res.json({ success: true });
});

export default router;
