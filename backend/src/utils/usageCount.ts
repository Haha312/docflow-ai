/**
 * 额度计数与周期工具。
 *
 * P2-1 缓存设计:Redis 只做"缓存",DB 永远是真实源。
 *   - 命中:直接返回缓存的 count(60s TTL)
 *   - 未命中 / Redis 不可用(MockRedis 重启清空):回落 DB count
 *   → 缓存丢失只多查一次 DB,绝不会导致额度错乱(与"纯 Redis 计数器"的本质区别)。
 *   失效:每次写 UsageLog(generate.ts)后 del 该用户缓存。
 *
 * P2-2 周期设计:付费用户额度按"购买日对齐"的月周期重置,而非自然月。
 *   - User.quotaPeriodStart 在付款升级时写入(payment.ts applyPaidOrder)
 *   - 当前周期起点 = quotaPeriodStart 往后推整数个月,落在 [now-1月, now] 区间
 *   - 老用户 quotaPeriodStart=null → 回落自然月(向后兼容,行为同旧版)
 *   - FREE 用户是终身计数,不涉及周期。
 */
import prisma from '../config/database';
import redis from './redis';

const CACHE_TTL_SEC = 60;

const cacheKey = (userId: string) => `quota:count:${userId}`;

/**
 * 安全的"加 N 个月":日期钳制到目标月份的最后一天(处理 1/31 → 2/28)。
 */
function addMonthsClamped(date: Date, months: number): Date {
    const d = new Date(date);
    const targetMonth = d.getMonth() + months;
    d.setMonth(targetMonth);
    // setMonth 溢出说明原日期日号超过目标月天数(如 1/31 + 1月 = 3/3),回退到月末
    if (d.getMonth() !== ((targetMonth % 12) + 12) % 12) {
        d.setDate(0); // 上个月最后一天
    }
    return d;
}

/**
 * 付费用户当前额度周期的起点。
 * quotaPeriodStart 为空(老用户/未写入)→ 回落自然月 1 号(旧行为)。
 */
export function getPeriodStart(quotaPeriodStart: Date | null | undefined): Date {
    if (!quotaPeriodStart) {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        return monthStart;
    }
    const now = Date.now();
    let cursor = new Date(quotaPeriodStart);
    // 往后推整月,直到下一个周期起点超过 now
    // (循环上限防御性设置:订阅最长按 10 年算也只有 120 次)
    for (let i = 0; i < 200; i++) {
        const next = addMonthsClamped(cursor, 1);
        if (next.getTime() > now) break;
        cursor = next;
    }
    return cursor;
}

/**
 * 用户已用额度(generate_document 次数),带 60s Redis 缓存。
 * @param periodStart FREE 传 null(终身计数);付费传 getPeriodStart(...) 结果
 */
export async function getUsageCount(userId: string, periodStart: Date | null): Promise<number> {
    const key = cacheKey(userId);
    try {
        const cached = await redis.get(key);
        if (cached !== null) {
            const n = parseInt(cached, 10);
            if (!Number.isNaN(n)) return n;
        }
    } catch { /* Redis 出错回落 DB */ }

    const count = await prisma.usageLog.count({
        where: {
            userId,
            actionType: 'generate_document',
            ...(periodStart ? { createdAt: { gte: periodStart } } : {}),
        },
    });

    try {
        await redis.set(key, String(count), 'EX', CACHE_TTL_SEC);
    } catch { /* 缓存写失败不影响正确性 */ }

    return count;
}

/**
 * 失效缓存 — 在写 UsageLog 之后调用,确保下一次额度查询拿到最新值。
 */
export async function invalidateUsageCount(userId: string): Promise<void> {
    try {
        await redis.del(cacheKey(userId));
    } catch { /* 失效失败最多延迟 60s 刷新,不致命 */ }
}
