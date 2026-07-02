/**
 * 支付订单对账 + 过期清理定时任务。
 *
 * 解决两个问题:
 *   1. webhook 偶尔丢失:支付平台已收到付款但回调被网络/防火墙拦截
 *   2. PENDING 订单堆积:用户扫码后没付款,订单一直挂在 PENDING
 *
 * 调度:
 *   - 启动 30s 后首次运行,之后每 10 分钟跑一次
 *   - 单实例。如果未来要多实例部署,需要加 Redis lock 避免并发对账
 *
 * 每次执行的两个动作:
 *   A. 对账:对 createdAt 在 (24h, 5min) 之间的 PENDING 订单,主动调
 *      alipay.trade.query / pay/orderquery 拉真实状态;若已支付 → 调
 *      applyPaidOrderInline 完成会员升级;若已关闭 → 标记 EXPIRED
 *   B. 过期清理:对 createdAt < 24h 之前的 PENDING 订单直接 EXPIRED
 *
 * 故意不动 payment.ts 的 applyPaidOrder — 内联复制一份逻辑,避免
 * 修改原文件引入 regression。两份逻辑应该保持一致;若以后任一处
 * 改了升级规则,记得同步另一处。
 */
import prisma from '../config/database';
import { getAlipayClient } from '../utils/alipayClient';
import {
    getWechatConfig,
    signWechat,
    parseSimpleXml,
    toXml,
    randomNonceStr,
} from '../utils/wechatPay';
import { getWechatV3Config, queryWechatV3Order } from '../utils/wechatPayV3';
import { getTierFromPlanType } from '../config/tierConfig';
import { fetch as undiciFetch } from 'undici';

const RECONCILIATION_INTERVAL_MS = 10 * 60 * 1000; // 10 min
const MIN_AGE_FOR_RECONCILE_MS = 5 * 60 * 1000; // 不查太新的(用户可能还在扫码)
const EXPIRE_AFTER_MS = 24 * 60 * 60 * 1000; // 24h 未支付 → EXPIRED
const FIRST_RUN_DELAY_MS = 30 * 1000;

// 每种 planType 对应的会员天数。要和 payment.ts 的 PRICING 表保持一致。
const PRICING_DURATION: Record<string, number> = {
    plus_monthly: 30,
    plus_yearly: 365,
    pro_monthly: 30,
    pro_yearly: 365,
    ultra_monthly: 30,
    ultra_yearly: 365,
};

const inferPaymentMethod = (orderId: string): 'alipay' | 'wechat' | 'qrcode' | 'unknown' => {
    if (orderId.startsWith('DOCUFLOW_')) return 'alipay';
    if (orderId.startsWith('WX_')) return 'wechat';
    if (orderId.startsWith('QR_')) return 'qrcode';
    return 'unknown';
};

/**
 * 与 payment.ts:applyPaidOrder 等价的内联版本。
 * 用 updateMany WHERE status=PENDING 保证原子性,防重复处理。
 */
async function applyPaidOrderInline(orderId: string, userId: string, planType: string): Promise<boolean> {
    const updated = await prisma.order.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'PAID' },
    });
    if (updated.count === 0) return false;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { subscriptionEndDate: true },
    });

    const now = new Date();
    const baseDate =
        user?.subscriptionEndDate && user.subscriptionEndDate > now
            ? new Date(user.subscriptionEndDate)
            : now;

    const days = PRICING_DURATION[planType] || 30;
    const endDate = new Date(baseDate);
    endDate.setDate(endDate.getDate() + days);

    await prisma.user.update({
        where: { id: userId },
        data: {
            subscriptionStatus: getTierFromPlanType(planType),
            subscriptionEndDate: endDate,
        },
    });

    console.log(`[reconciliation] recovered PAID for order=${orderId} user=${userId} plan=${planType}`);
    return true;
}

type AlipayState = 'TRADE_SUCCESS' | 'TRADE_FINISHED' | 'WAIT_BUYER_PAY' | 'TRADE_CLOSED' | null;

async function queryAlipayOrder(outTradeNo: string): Promise<AlipayState> {
    const alipay = getAlipayClient();
    if (!alipay) return null;
    try {
        const r = await alipay.sdk.exec('alipay.trade.query', {
            bizContent: { outTradeNo },
        } as Record<string, unknown>);
        const code = (r as { code?: string }).code;
        if (code !== '10000') return null;
        return (((r as { tradeStatus?: string }).tradeStatus) as AlipayState) ?? null;
    } catch (e) {
        console.error('[reconciliation] alipay query failed:', (e as Error).message);
        return null;
    }
}

type WechatState = 'SUCCESS' | 'NOTPAY' | 'CLOSED' | 'PAYERROR' | 'USERPAYING' | 'REFUND' | 'REVOKED' | null;

async function queryWechatOrder(outTradeNo: string): Promise<WechatState> {
    if (getWechatV3Config()) {
        return (await queryWechatV3Order(outTradeNo)) as WechatState;
    }

    const cfg = getWechatConfig();
    if (!cfg) return null;
    try {
        const params: Record<string, string | number> = {
            appid: cfg.appId,
            mch_id: cfg.mchId,
            out_trade_no: outTradeNo,
            nonce_str: randomNonceStr(),
        };
        params.sign = signWechat(params, cfg.apiKey);

        const url = process.env.WECHAT_ORDERQUERY_URL || 'https://api.mch.weixin.qq.com/pay/orderquery';
        const resp = await undiciFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml; charset=utf-8' },
            body: toXml(params),
        });
        const xml = await resp.text();
        const data = parseSimpleXml(xml);
        if (data.return_code !== 'SUCCESS' || data.result_code !== 'SUCCESS') return null;
        return ((data.trade_state as WechatState) || null);
    } catch (e) {
        console.error('[reconciliation] wechat query failed:', (e as Error).message);
        return null;
    }
}

async function runReconciliation(): Promise<void> {
    const now = new Date();
    const minAge = new Date(now.getTime() - MIN_AGE_FOR_RECONCILE_MS);
    const expireBoundary = new Date(now.getTime() - EXPIRE_AFTER_MS);

    // A. 主动查询 (createdAt 在 [-24h, -5min] 之间的 PENDING)
    const toReconcile = await prisma.order.findMany({
        where: {
            status: 'PENDING',
            createdAt: { gt: expireBoundary, lt: minAge },
        },
        select: { id: true, userId: true, planType: true },
    });

    let recoveredPaid = 0;
    let closedByPlatform = 0;

    for (const order of toReconcile) {
        const method = inferPaymentMethod(order.id);
        try {
            if (method === 'alipay') {
                const state = await queryAlipayOrder(order.id);
                if (state === 'TRADE_SUCCESS' || state === 'TRADE_FINISHED') {
                    if (await applyPaidOrderInline(order.id, order.userId, order.planType)) {
                        recoveredPaid++;
                    }
                } else if (state === 'TRADE_CLOSED') {
                    await prisma.order.updateMany({
                        where: { id: order.id, status: 'PENDING' },
                        data: { status: 'EXPIRED' },
                    });
                    closedByPlatform++;
                }
            } else if (method === 'wechat') {
                const state = await queryWechatOrder(order.id);
                if (state === 'SUCCESS') {
                    if (await applyPaidOrderInline(order.id, order.userId, order.planType)) {
                        recoveredPaid++;
                    }
                } else if (state === 'CLOSED' || state === 'PAYERROR' || state === 'REVOKED') {
                    await prisma.order.updateMany({
                        where: { id: order.id, status: 'PENDING' },
                        data: { status: 'EXPIRED' },
                    });
                    closedByPlatform++;
                }
            }
            // qrcode / unknown: 不主动查询
        } catch (e) {
            console.error(`[reconciliation] order ${order.id} reconcile failed:`, (e as Error).message);
        }
    }

    // B. 过期清理 (createdAt < 24h 之前的 PENDING 直接 EXPIRED)
    const expiredResult = await prisma.order.updateMany({
        where: {
            status: 'PENDING',
            createdAt: { lt: expireBoundary },
        },
        data: { status: 'EXPIRED' },
    });

    if (toReconcile.length > 0 || expiredResult.count > 0) {
        console.log(
            `[reconciliation] scanned=${toReconcile.length} recovered_paid=${recoveredPaid} closed=${closedByPlatform} expired=${expiredResult.count}`
        );
    }
}

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * 启动定时对账任务。重复调用安全(已运行时为 no-op)。
 *
 * 不适用于:
 *   - Vercel / Cloudflare Workers 等 serverless (setInterval 不持久)
 *   - 多实例部署 (会重复执行;需加 Redis 分布式锁)
 */
export function startPaymentReconciliationJob(): void {
    if (intervalHandle) return;

    setTimeout(() => {
        runReconciliation().catch((e) => console.error('[reconciliation] first run failed:', e));
        intervalHandle = setInterval(() => {
            runReconciliation().catch((e) => console.error('[reconciliation] interval run failed:', e));
        }, RECONCILIATION_INTERVAL_MS);
    }, FIRST_RUN_DELAY_MS);

    console.log(
        `[reconciliation] scheduled (first run in ${FIRST_RUN_DELAY_MS / 1000}s, then every ${RECONCILIATION_INTERVAL_MS / 60000}min)`
    );
}

export function stopPaymentReconciliationJob(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}
