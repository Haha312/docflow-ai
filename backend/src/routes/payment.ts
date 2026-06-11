import { Router, Request, Response } from 'express';
import AlipaySdk from 'alipay-sdk';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import { fetch as undiciFetch } from 'undici';
import { AuthRequest, CreateCheckoutRequest } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import { authenticate } from '../middleware/auth';
import prisma from '../config/database';
import { getTierFromPlanType } from '../config/tierConfig';
import { sendPaymentSuccess } from '../services/emailService';
import { isAdmin } from '../utils/admin';
import { getAlipayClient } from '../utils/alipayClient';
import { wechatRefund } from '../utils/wechatPay';
import redis from '../utils/redis';

const router = Router();

// 推断订单使用的支付方式 — 创建订单时按前缀写入,这里按前缀反推
const inferPaymentMethod = (orderId: string): 'alipay' | 'wechat' | 'qrcode' | 'unknown' => {
    if (orderId.startsWith('DOCUFLOW_')) return 'alipay';
    if (orderId.startsWith('WX_')) return 'wechat';
    if (orderId.startsWith('QR_')) return 'qrcode';
    return 'unknown';
};

const PRICING: Record<string, { amountUSD: number; amountCNY: number; duration: number; title: string }> = {
    plus_monthly: { amountUSD: 4.99, amountCNY: 29, duration: 30, title: 'Plus (Monthly)' },
    plus_yearly: { amountUSD: 49.99, amountCNY: 298, duration: 365, title: 'Plus (Yearly)' },
    pro_monthly: { amountUSD: 8.99, amountCNY: 59, duration: 30, title: 'Pro (Monthly)' },
    pro_yearly: { amountUSD: 89.99, amountCNY: 598, duration: 365, title: 'Pro (Yearly)' },
    ultra_monthly: { amountUSD: 13.99, amountCNY: 99, duration: 30, title: 'Ultra (Monthly)' },
    ultra_yearly: { amountUSD: 139.99, amountCNY: 998, duration: 365, title: 'Ultra (Yearly)' }
};

const getBackendBaseUrl = () => process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
const randomNonceStr = () => crypto.randomBytes(16).toString('hex');

const parseSimpleXml = (xml: string): Record<string, string> => {
    const result: Record<string, string> = {};
    const regex = /<([^/>]+)><!\[CDATA\[(.*?)\]\]><\/\1>|<([^/>]+)>([^<]*)<\/\3>/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
        const key = match[1] || match[3];
        const value = (match[2] ?? match[4] ?? '').trim();
        result[key] = value;
    }
    return result;
};

const toXml = (params: Record<string, string | number>) => {
    const body = Object.entries(params)
        .map(([k, v]) => `<${k}><![CDATA[${String(v)}]]></${k}>`)
        .join('');
    return `<xml>${body}</xml>`;
};

const signWechat = (params: Record<string, string | number>, apiKey: string) => {
    const qs = Object.keys(params)
        .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== '')
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&');
    return crypto.createHash('md5').update(`${qs}&key=${apiKey}`, 'utf8').digest('hex').toUpperCase();
};

const resolveClientIp = (req: Request): string => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = Array.isArray(forwarded)
        ? forwarded[0]
        : (forwarded?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1');
    return ip.replace('::ffff:', '').trim();
};

const respondWechatXml = (res: Response, ok: boolean, msg = 'OK') => {
    const xml = toXml({
        return_code: ok ? 'SUCCESS' : 'FAIL',
        return_msg: msg
    });
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    res.send(xml);
};

async function applyPaidOrder(
    orderId: string,
    _webhookUserId: string,
    planType: string
): Promise<void> {
    const existing = await prisma.order.findUnique({ where: { id: orderId } });
    if (!existing) return;

    // Always use the userId stored in the order at creation time (authenticated context).
    // Never trust userId from passback_params / attach — those are user-controlled fields.
    const userId = existing.userId;

    const plan = PRICING[planType] || PRICING[existing.planType];
    if (!plan) return;

    // Atomic update: only proceed if order is still PENDING (prevents duplicate processing)
    const updated = await prisma.order.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'PAID' }
    });
    if (updated.count === 0) return;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, subscriptionEndDate: true }
    });

    // If the user is already active, extend from current expiry; otherwise start from now.
    const now = new Date();
    const baseDate =
        user?.subscriptionEndDate && user.subscriptionEndDate > now
            ? new Date(user.subscriptionEndDate)
            : now;
    const endDate = new Date(baseDate);
    endDate.setDate(endDate.getDate() + plan.duration);

    await prisma.user.update({
        where: { id: userId },
        data: {
            subscriptionStatus: getTierFromPlanType(planType),
            subscriptionEndDate: endDate,
            // 额度周期起点对齐付款时间(月度额度按购买日重置,而非自然月 1 号)
            quotaPeriodStart: now
        }
    });

    // 异步发送支付成功邮件 — 失败不阻断主流程(订单已 PAID + 会员已激活)
    if (user?.email) {
        sendPaymentSuccess(
            user.email,
            plan.title,
            plan.amountCNY,
            'CNY',
            endDate
        ).catch((e) => console.error('Payment success email failed (non-blocking):', e));
    }
}

router.post('/create-checkout-session', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('Unauthorized', 401));
            return;
        }

        const { planType, paymentMethod = 'alipay' }: CreateCheckoutRequest = req.body;
        if (!planType || !PRICING[planType]) {
            res.status(400).json(errorResponse('Invalid plan type', 400));
            return;
        }

        if (!['alipay', 'wechat', 'qrcode'].includes(paymentMethod)) {
            res.status(400).json(errorResponse('Invalid payment method', 400));
            return;
        }

        const plan = PRICING[planType];

        if (paymentMethod === 'alipay') {
            const alipayAppId = process.env.ALIPAY_APP_ID;
            const alipayPrivateKey = process.env.ALIPAY_PRIVATE_KEY;
            const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;

            const certDir = path.join(process.cwd(), 'Alipay');
            const alipayRootCertPath = path.join(certDir, 'alipayRootCert.crt');
            const alipayPublicCertPath = path.join(certDir, 'alipayCertPublicKey_RSA2.crt');
            const appCertFiles = fs.existsSync(certDir)
                ? fs.readdirSync(certDir).filter((f) => f.startsWith('appCertPublicKey_') && f.endsWith('.crt'))
                : [];
            const appCertPath = appCertFiles.length > 0 ? path.join(certDir, appCertFiles[0]) : null;

            const hasKeyMode = !!(alipayAppId && alipayPrivateKey && alipayPublicKey);
            const hasCertMode = !!(alipayPrivateKey && appCertPath && fs.existsSync(alipayRootCertPath) && fs.existsSync(alipayPublicCertPath));

            if (!hasKeyMode && !hasCertMode) {
                res.status(503).json(errorResponse('Alipay is not configured', 503));
                return;
            }

            let AlipayCtor: any = AlipaySdk as any;
            if (typeof AlipayCtor !== 'function') {
                const pkg = require('alipay-sdk');
                AlipayCtor = pkg.default || pkg.AlipaySdk || pkg;
            }

            const sdkConfig: Record<string, any> = {
                privateKey: alipayPrivateKey,
                gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
                signType: 'RSA2'
            };

            if (hasCertMode && appCertPath) {
                sdkConfig.appId = alipayAppId || path.basename(appCertPath).split('_')[1].split('.')[0];
                sdkConfig.alipayRootCertPath = alipayRootCertPath;
                sdkConfig.alipayPublicCertPath = alipayPublicCertPath;
                sdkConfig.appCertPath = appCertPath;
            } else {
                sdkConfig.appId = alipayAppId;
                sdkConfig.alipayPublicKey = alipayPublicKey;
            }

            const alipaySdk = new AlipayCtor(sdkConfig);
            const outTradeNo = `DOCUFLOW_${Date.now()}_${user.id.substring(0, 8)}_${randomNonceStr().substring(0, 6)}`;
            const notifyUrl = process.env.ALIPAY_NOTIFY_URL || `${getBackendBaseUrl()}/api/payment/webhook/alipay`;

            const result = await alipaySdk.exec('alipay.trade.precreate', {
                bizContent: {
                    outTradeNo,
                    totalAmount: plan.amountCNY.toFixed(2),
                    subject: `DocFlow AI - ${plan.title}`,
                    body: 'Unlock premium AI formatting',
                    passbackParams: encodeURIComponent(JSON.stringify({ userId: user.id, planType }))
                },
                notifyUrl
            });

            if (result.code !== '10000' || !result.qr_code) {
                throw new Error(result.subMsg || result.msg || 'Failed to create Alipay order');
            }

            await prisma.order.create({
                data: {
                    id: outTradeNo,
                    userId: user.id,
                    amount: plan.amountCNY,
                    currency: 'CNY',
                    planType,
                    status: 'PENDING'
                }
            });

            res.json(successResponse({ paymentMethod: 'alipay', orderId: outTradeNo, qrCode: result.qr_code }, 'Alipay order created'));
            return;
        }

        if (paymentMethod === 'wechat') {
            const appId = process.env.WECHAT_APP_ID;
            const mchId = process.env.WECHAT_MCH_ID;
            const apiKey = process.env.WECHAT_API_KEY;
            if (!appId || !mchId || !apiKey) {
                res.status(503).json(errorResponse('WeChat Pay is not configured', 503));
                return;
            }

            const outTradeNo = `WX_${Date.now()}_${user.id.substring(0, 8)}_${randomNonceStr().substring(0, 6)}`;
            const notifyUrl = process.env.WECHAT_NOTIFY_URL || `${getBackendBaseUrl()}/api/payment/webhook/wechat`;
            const params: Record<string, string | number> = {
                appid: appId,
                mch_id: mchId,
                nonce_str: randomNonceStr(),
                body: `DocFlow AI - ${plan.title}`,
                out_trade_no: outTradeNo,
                total_fee: Math.round(plan.amountCNY * 100),
                spbill_create_ip: resolveClientIp(req),
                notify_url: notifyUrl,
                trade_type: 'NATIVE',
                attach: encodeURIComponent(JSON.stringify({ userId: user.id, planType }))
            };
            params.sign = signWechat(params, apiKey);

            const unifiedOrderUrl = process.env.WECHAT_UNIFIEDORDER_URL || 'https://api.mch.weixin.qq.com/pay/unifiedorder';
            const wxResp = await undiciFetch(unifiedOrderUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml; charset=utf-8' },
                body: toXml(params)
            });
            const wxXml = await wxResp.text();
            const wxData = parseSimpleXml(wxXml);

            if (wxData.return_code !== 'SUCCESS' || wxData.result_code !== 'SUCCESS' || !wxData.code_url) {
                const msg = wxData.return_msg || wxData.err_code_des || 'Failed to create WeChat order';
                res.status(502).json(errorResponse(msg, 502));
                return;
            }

            await prisma.order.create({
                data: {
                    id: outTradeNo,
                    userId: user.id,
                    amount: plan.amountCNY,
                    currency: 'CNY',
                    planType,
                    status: 'PENDING'
                }
            });

            res.json(successResponse({ paymentMethod: 'wechat', orderId: outTradeNo, qrCode: wxData.code_url }, 'WeChat order created'));
            return;
        }

        // Legacy local QR fallback (kept for backward compatibility)
        const outTradeNo = `QR_${Date.now()}_${user.id.substring(0, 8)}_${randomNonceStr().substring(0, 6)}`;
        await prisma.order.create({
            data: {
                id: outTradeNo,
                userId: user.id,
                amount: plan.amountCNY,
                currency: 'CNY',
                planType,
                status: 'PENDING'
            }
        });
        res.json(successResponse({
            paymentMethod: 'qrcode',
            orderId: outTradeNo,
            amount: plan.amountCNY,
            alipayQrUrl: '/api/payment/qrcode-image?type=alipay',
            wechatQrUrl: '/api/payment/qrcode-image?type=wechat'
        }, 'Order created'));
    } catch (error) {
        console.error('Create checkout session error:', error);
        res.status(500).json(errorResponse('Failed to create checkout session', 500));
    }
});

router.all('/webhook/alipay', async (req: Request, res: Response): Promise<void> => {
    try {
        const alipayAppId = process.env.ALIPAY_APP_ID;
        const alipayPrivateKey = process.env.ALIPAY_PRIVATE_KEY;
        const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;

        if (!alipayAppId || !alipayPrivateKey) {
            res.status(503).send('fail');
            return;
        }

        const certDir = path.join(process.cwd(), 'Alipay');
        const alipayRootCertPath = path.join(certDir, 'alipayRootCert.crt');
        const alipayPublicCertPath = path.join(certDir, 'alipayCertPublicKey_RSA2.crt');
        const appCertFiles = fs.existsSync(certDir)
            ? fs.readdirSync(certDir).filter((f) => f.startsWith('appCertPublicKey_') && f.endsWith('.crt'))
            : [];
        const appCertPath = appCertFiles.length > 0 ? path.join(certDir, appCertFiles[0]) : null;
        const hasCertMode = !!(appCertPath && fs.existsSync(alipayRootCertPath) && fs.existsSync(alipayPublicCertPath));
        const hasKeyMode = !!alipayPublicKey;

        if (!hasCertMode && !hasKeyMode) {
            res.status(503).send('fail');
            return;
        }

        const AlipayCtor: any = (AlipaySdk as any).default || (AlipaySdk as any).AlipaySdk || (AlipaySdk as any);
        const sdkConfig: Record<string, any> = { privateKey: alipayPrivateKey, signType: 'RSA2' };
        if (hasCertMode && appCertPath) {
            sdkConfig.appId = alipayAppId;
            sdkConfig.alipayRootCertPath = alipayRootCertPath;
            sdkConfig.alipayPublicCertPath = alipayPublicCertPath;
            sdkConfig.appCertPath = appCertPath;
        } else {
            sdkConfig.appId = alipayAppId;
            sdkConfig.alipayPublicKey = alipayPublicKey;
        }
        const alipaySdk = new AlipayCtor(sdkConfig);

        const params: any = req.method === 'POST' ? req.body : req.query;
        if (!alipaySdk.checkNotifySign(params)) {
            res.status(400).send('fail');
            return;
        }

        // 重放保护:支付宝的 notify_id 每次回调都是唯一的,缓存 24h 避免重复处理
        const notifyId = params.notify_id;
        if (notifyId) {
            const replayKey = `webhook:alipay:notify_id:${notifyId}`;
            const seen = await redis.get(replayKey);
            if (seen) {
                console.warn(`[alipay webhook] duplicate notify_id=${notifyId}, skipping`);
                res.send('success'); // 仍然返回 success,告诉支付宝不要再重试
                return;
            }
            await redis.set(replayKey, '1', 'EX', 86400);
        }

        const tradeStatus = params.trade_status;
        const outTradeNo = params.out_trade_no;
        if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
            const passback = params.passback_params ? JSON.parse(decodeURIComponent(params.passback_params)) : {};
            const userId = passback.userId;
            const planType = passback.planType;
            if (outTradeNo && userId && planType) {
                await applyPaidOrder(outTradeNo, userId, planType);
            }
        }

        res.send('success');
    } catch (error) {
        console.error('Alipay webhook error:', error);
        res.status(500).send('fail');
    }
});

router.post('/webhook/wechat', async (req: Request, res: Response): Promise<void> => {
    try {
        const apiKey = process.env.WECHAT_API_KEY;
        if (!apiKey) {
            respondWechatXml(res, false, 'API key missing');
            return;
        }

        const rawBody = typeof req.body === 'string' ? req.body : String(req.body || '');
        if (!rawBody) {
            respondWechatXml(res, false, 'Empty body');
            return;
        }

        const data = parseSimpleXml(rawBody);
        const receivedSign = data.sign || '';
        const calculatedSign = signWechat(data, apiKey);
        // 常量时间比较 + 长度检查,防止时序攻击
        const signOk = receivedSign.length === calculatedSign.length
            && receivedSign.length > 0
            && crypto.timingSafeEqual(Buffer.from(receivedSign), Buffer.from(calculatedSign));
        if (!signOk) {
            respondWechatXml(res, false, 'Invalid sign');
            return;
        }

        if (data.return_code !== 'SUCCESS' || data.result_code !== 'SUCCESS') {
            respondWechatXml(res, true, 'IGNORE');
            return;
        }

        // 重放保护:用 transaction_id (微信支付订单号) 作为唯一标识
        const transactionId = data.transaction_id;
        if (transactionId) {
            const replayKey = `webhook:wechat:transaction_id:${transactionId}`;
            const seen = await redis.get(replayKey);
            if (seen) {
                console.warn(`[wechat webhook] duplicate transaction_id=${transactionId}, skipping`);
                respondWechatXml(res, true, 'DUPLICATE');
                return;
            }
            await redis.set(replayKey, '1', 'EX', 86400);
        }

        const outTradeNo = data.out_trade_no;
        const attachRaw = data.attach || '';
        let userId = '';
        let planType = '';

        try {
            const attach = JSON.parse(decodeURIComponent(attachRaw));
            userId = attach.userId || '';
            planType = attach.planType || '';
        } catch {
            // ignore parsing error and fallback to order info
        }

        if (outTradeNo) {
            const order = await prisma.order.findUnique({ where: { id: outTradeNo } });
            if (order) {
                await applyPaidOrder(outTradeNo, userId || order.userId, planType || order.planType);
            }
        }

        respondWechatXml(res, true, 'OK');
    } catch (error) {
        console.error('WeChat webhook error:', error);
        respondWechatXml(res, false, 'Server error');
    }
});

router.post('/confirm-by-amount', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const manualConfirmEnabled =
            process.env.NODE_ENV !== 'production' &&
            process.env.ENABLE_INSECURE_PAYMENT_CONFIRM === 'true';

        if (!manualConfirmEnabled) {
            res.status(410).json(errorResponse('Manual confirm endpoint is disabled', 410));
            return;
        }

        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('Unauthorized', 401));
            return;
        }

        const { monum } = req.body;
        if (monum === undefined || monum === null) {
            res.status(400).json(errorResponse('Missing monum parameter', 400));
            return;
        }

        const amount = parseFloat(monum);
        if (Number.isNaN(amount)) {
            res.status(400).json(errorResponse('Invalid monum value', 400));
            return;
        }

        const order = await prisma.order.findFirst({ where: { userId: user.id, status: 'PENDING', amount }, orderBy: { createdAt: 'asc' } });
        if (!order) {
            res.status(404).json(errorResponse('No matching pending order found', 404));
            return;
        }

        await applyPaidOrder(order.id, order.userId, order.planType);
        res.json(successResponse({ orderId: order.id, userId: order.userId }, 'Payment confirmed'));
    } catch (error) {
        console.error('Confirm by amount error:', error);
        res.status(500).json(errorResponse('Failed to confirm payment', 500));
    }
});

router.get('/status/:orderId', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('Unauthorized', 401));
            return;
        }

        const orderId = String(req.params.orderId || '');
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order || order.userId !== user.id) {
            res.status(404).json(errorResponse('Order not found', 404));
            return;
        }

        res.json(successResponse({ status: order.status }));
    } catch (error) {
        console.error('Check payment status error:', error);
        res.status(500).json(errorResponse('Failed to check payment status', 500));
    }
});

/**
 * POST /api/payment/refund/:orderId
 * 申请退款。
 *
 * 权限:
 *   - 用户:只能退自己的订单
 *   - admin:可以退任何订单
 *
 * 行为:
 *   1. 校验订单存在 + 状态为 PAID
 *   2. 原子标记为 REFUNDING (防重复退款)
 *   3. 调用支付宝/微信退款 API
 *   4. 成功 → REFUNDED + 用户立即降级为 FREE + 写 UsageLog 备查
 *   5. 失败 → 回滚到 PAID,返回错误给前端
 *
 * 注意:目前是全额退款 + 立即降级,不按"已使用天数"按比例扣除。
 * 后续如需"按比例退款",在这里改 refundAmount 计算逻辑即可。
 */
router.post('/refund/:orderId', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('Unauthorized', 401));
            return;
        }

        const orderId = String(req.params.orderId || '');
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) {
            res.status(404).json(errorResponse('Order not found', 404));
            return;
        }

        const isOrderOwner = order.userId === user.id;
        const isAdminUser = await isAdmin(user.email);
        if (!isOrderOwner && !isAdminUser) {
            res.status(403).json(errorResponse('无权操作该订单', 403));
            return;
        }

        if (order.status !== 'PAID') {
            res.status(400).json(errorResponse(`订单当前状态为 ${order.status},无法退款`, 400));
            return;
        }

        // 退款门槛:付款后产生过使用记录(消耗过额度)→ 不允许自助退款,走客服。
        // 防"付款 → 用满额度 → 全额退款"薅羊毛。基准用 order.createdAt(无 paidAt 字段,
        // 偏保守 = 多拒少漏)。admin 代退可绕过。
        if (!isAdminUser) {
            const usedCount = await prisma.usageLog.count({
                where: {
                    userId: order.userId,
                    actionType: 'generate_document',
                    createdAt: { gte: order.createdAt },
                },
            });
            if (usedCount > 0) {
                res.status(400).json(errorResponse('该订单已产生使用记录,无法自助退款,请联系客服处理', 400));
                return;
            }
        }

        // 原子标记 REFUNDING,防止并发重复退款
        const marked = await prisma.order.updateMany({
            where: { id: orderId, status: 'PAID' },
            data: { status: 'REFUNDING' },
        });
        if (marked.count === 0) {
            res.status(409).json(errorResponse('订单状态已变化,请刷新重试', 409));
            return;
        }

        const method = inferPaymentMethod(orderId);
        const amountStr = Number(order.amount).toFixed(2);
        const amountFen = Math.round(Number(order.amount) * 100);
        let refundOk = false;
        let refundMsg = '';

        try {
            if (method === 'alipay') {
                const alipay = getAlipayClient();
                if (!alipay) {
                    refundMsg = 'Alipay not configured';
                } else {
                    const r = await alipay.sdk.exec('alipay.trade.refund', {
                        bizContent: {
                            outTradeNo: orderId,
                            refundAmount: amountStr,
                            outRequestNo: `REFUND_${orderId}_${Date.now()}`,
                            refundReason: req.body?.reason || 'User initiated refund',
                        },
                    } as Record<string, unknown>);
                    const code = (r as { code?: string }).code;
                    const fundChange = (r as { fundChange?: string }).fundChange;
                    if (code === '10000' && fundChange === 'Y') {
                        refundOk = true;
                    } else {
                        refundMsg = ((r as { subMsg?: string; msg?: string }).subMsg) || ((r as { msg?: string }).msg) || 'Alipay refund failed';
                    }
                }
            } else if (method === 'wechat') {
                const r = await wechatRefund({
                    outTradeNo: orderId,
                    outRefundNo: `REFUND_${orderId}_${Date.now()}`.substring(0, 64),
                    totalFeeFen: amountFen,
                    refundFeeFen: amountFen,
                    reason: req.body?.reason,
                });
                if (r.success) {
                    refundOk = true;
                } else {
                    refundMsg = r.errMsg || 'WeChat refund failed';
                }
            } else if (method === 'qrcode') {
                // QR 兜底订单(没有真实支付通道),只能人工对账
                refundMsg = 'QR-only orders cannot be auto-refunded; contact support';
            } else {
                refundMsg = `Unknown payment method for order ${orderId}`;
            }
        } catch (err) {
            refundMsg = (err as Error).message || 'refund call threw';
        }

        if (!refundOk) {
            // 回滚: REFUNDING → PAID
            await prisma.order.update({ where: { id: orderId }, data: { status: 'PAID' } });
            res.status(502).json(errorResponse(`退款失败: ${refundMsg}`, 502));
            return;
        }

        // 成功: REFUNDING → REFUNDED + 用户降级
        await prisma.order.update({ where: { id: orderId }, data: { status: 'REFUNDED' } });

        await prisma.user.update({
            where: { id: order.userId },
            data: { subscriptionStatus: 'FREE', subscriptionEndDate: null },
        });

        await prisma.usageLog.create({
            data: {
                userId: order.userId,
                actionType: 'refund_success',
                presetUsed: `order=${orderId}|amount=${amountStr}|by=${isAdminUser ? 'admin' : 'user'}`,
            },
        });

        res.json(successResponse(
            { orderId, status: 'REFUNDED' },
            '退款已申请,款项将在 1-3 个工作日内退回原支付账户'
        ));
    } catch (error) {
        console.error('Refund error:', error);
        res.status(500).json(errorResponse('退款处理失败', 500));
    }
});

router.get('/qrcode-image', (req: Request, res: Response): void => {
    const type = (req.query.type as string) || 'alipay';
    const imageMap: Record<string, string> = { alipay: 'Alipay.jpg', wechat: 'wechat.png' };

    const fileName = imageMap[type] || imageMap.alipay;
    const imagePath = path.join(process.cwd(), '..', 'frontend', 'image', fileName);

    if (fs.existsSync(imagePath)) {
        res.sendFile(imagePath);
    } else {
        res.status(404).json(errorResponse(`QR code image not found: ${fileName}`, 404));
    }
});

export default router;
