/**
 * 续费提醒定时任务。
 *
 * 调度:启动 30s 后立即检查一次(避免错过当天 09:00),之后每天 09:00 跑一次。
 *
 * 行为:对 subscriptionEndDate 在 [now, now+8d) 且 subscriptionStatus ≠ FREE 的用户,
 * 算出 daysLeft,落在 {7, 3, 1} 三个 bucket 之一才发邮件;Redis key
 * `reminder:${userId}:${daysLeft}` 8 天 TTL 防重发(避免重启 server 时重复发)。
 *
 * 不适用于:
 *   - serverless 环境(setInterval 不持久)
 *   - 多实例部署(会重复发邮件;需 Redis SETNX lock,本期不做)
 */
import prisma from '../config/database';
import redis from '../utils/redis';
import { sendRenewalReminder } from './emailService';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 30 * 1000;
const REMINDER_TTL_SEC = 8 * 24 * 60 * 60; // 8 天

// 在到期前 N 天发送提醒
const REMINDER_DAYS = [7, 3, 1] as const;

const TIER_LABELS: Record<string, string> = {
    PLUS: 'Plus',
    PRO: 'Pro',
    ULTRA: 'Ultra',
};

function nextRunDelayMs(): number {
    const now = new Date();
    const target = new Date(now);
    target.setHours(9, 0, 0, 0);
    if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
    }
    return target.getTime() - now.getTime();
}

async function runReminder(): Promise<void> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 8 * ONE_DAY_MS);

    const candidates = await prisma.user.findMany({
        where: {
            subscriptionStatus: { not: 'FREE' },
            subscriptionEndDate: { gte: now, lte: windowEnd },
        },
        select: { id: true, email: true, subscriptionStatus: true, subscriptionEndDate: true },
    });

    let sent = 0;
    for (const u of candidates) {
        if (!u.subscriptionEndDate) continue;
        const msLeft = u.subscriptionEndDate.getTime() - now.getTime();
        const daysLeft = Math.ceil(msLeft / ONE_DAY_MS);

        // 只在 {7, 3, 1} 这三个 bucket 上发
        if (!REMINDER_DAYS.includes(daysLeft as 7 | 3 | 1)) continue;

        const lockKey = `reminder:${u.id}:${daysLeft}`;
        const alreadySent = await redis.get(lockKey);
        if (alreadySent) continue;

        const planName = TIER_LABELS[u.subscriptionStatus] || u.subscriptionStatus;
        try {
            const ok = await sendRenewalReminder(u.email, daysLeft, planName, u.subscriptionEndDate);
            if (ok) {
                await redis.set(lockKey, '1', 'EX', REMINDER_TTL_SEC);
                sent++;
            }
        } catch (e) {
            console.error(`[renewal-reminder] send failed for user ${u.id}:`, (e as Error).message);
        }
    }

    if (candidates.length > 0 || sent > 0) {
        console.log(`[renewal-reminder] candidates=${candidates.length} sent=${sent}`);
    }
}

let timeoutHandle: NodeJS.Timeout | null = null;
let intervalHandle: NodeJS.Timeout | null = null;

export function startRenewalReminderJob(): void {
    if (intervalHandle || timeoutHandle) return;

    // 30s 后跑一次(catch 启动时距 09:00 已过的情况),然后到下一个 09:00 + 每天 09:00
    setTimeout(() => {
        runReminder().catch((e) => console.error('[renewal-reminder] first run failed:', e));

        timeoutHandle = setTimeout(() => {
            runReminder().catch((e) => console.error('[renewal-reminder] scheduled run failed:', e));
            intervalHandle = setInterval(() => {
                runReminder().catch((e) => console.error('[renewal-reminder] interval run failed:', e));
            }, ONE_DAY_MS);
        }, nextRunDelayMs());
    }, FIRST_RUN_DELAY_MS);

    console.log(
        `[renewal-reminder] scheduled (first sweep in ${FIRST_RUN_DELAY_MS / 1000}s, then daily at 09:00)`
    );
}

export function stopRenewalReminderJob(): void {
    if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
    }
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}
