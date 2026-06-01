/**
 * 通用的 IP-based 限流 middleware,用于鉴权相关的端点(注册/登录/发送验证码)。
 *
 * 使用 Redis incr + expire 模式:
 *   - 首次访问:incr 返回 1 → expire 设窗口期
 *   - 后续:incr 计数,超过 limit 返回 429
 *
 * IP 来源:优先 x-forwarded-for[0](nginx 前置),其次 req.ip。
 * 注意:nginx 必须配置 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
 * 否则会拿到 nginx 的 internal IP 导致全局共享 counter。
 */
import { Request, Response, NextFunction } from 'express';
import redis from '../utils/redis';
import { errorResponse } from '../utils/response';

interface AuthRateLimitOptions {
    /** Redis key 前缀,通常按端点区分 (如 'rl:login', 'rl:register') */
    keyPrefix: string;
    /** 窗口期内允许的最大请求次数 */
    limit: number;
    /** 窗口期(秒) */
    windowSec: number;
}

function resolveClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded[0]) {
        return forwarded[0].split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
}

export function authRateLimit(options: AuthRateLimitOptions) {
    const { keyPrefix, limit, windowSec } = options;

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const ip = resolveClientIp(req);
            const key = `${keyPrefix}:${ip}`;

            const count = await redis.incr(key);
            if (count === 1) {
                // 首次:设置窗口期过期
                await redis.expire(key, windowSec);
            }

            if (count > limit) {
                res.status(429).json(errorResponse('AUTH_RATE_LIMIT', 429));
                return;
            }

            next();
        } catch (err) {
            // Redis 出错不阻塞用户(fail-open),只记日志
            console.error('[authRateLimit] redis error:', (err as Error).message);
            next();
        }
    };
}
