import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
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

const router = Router();

const PRICING: Record<string, { amountUSD: number; amountCNY: number; duration: number; title: string }> = {
    plus_monthly: { amountUSD: 2.99, amountCNY: 19, duration: 30, title: 'Plus (Monthly)' },
    plus_yearly: { amountUSD: 29.99, amountCNY: 198, duration: 365, title: 'Plus (Yearly)' },
    pro_monthly: { amountUSD: 3.99, amountCNY: 29, duration: 30, title: 'Pro (Monthly)' },
    pro_yearly: { amountUSD: 39.99, amountCNY: 298, duration: 365, title: 'Pro (Yearly)' },
    ultra_monthly: { amountUSD: 13.99, amountCNY: 99, duration: 30, title: 'Ultra (Monthly)' },
    ultra_yearly: { amountUSD: 139.99, amountCNY: 998, duration: 365, title: 'Ultra (Yearly)' }
};

const getBackendBaseUrl = () => process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
const getFrontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';
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

async function applyPaidOrder(orderId: string, userId: string, planType: string): Promise<void> {
    const existing = await prisma.order.findUnique({ where: { id: orderId } });
    if (!existing) return;
    if (existing.status === 'PAID') return;

    await prisma.order.update({ where: { id: orderId }, data: { status: 'PAID' } });

    const plan = PRICING[planType] || PRICING[existing.planType];
    if (!plan) return;

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.duration);

    await prisma.user.update({
        where: { id: userId },
        data: {
            subscriptionStatus: getTierFromPlanType(planType || existing.planType),
            subscriptionEndDate: endDate
        }
    });
}

router.post('/create-checkout-session', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('Unauthorized', 401));
            return;
        }

        const { planType, paymentMethod = 'stripe' }: CreateCheckoutRequest = req.body;
        if (!planType || !PRICING[planType]) {
            res.status(400).json(errorResponse('Invalid plan type', 400));
            return;
        }

        if (!['stripe', 'alipay', 'wechat', 'qrcode'].includes(paymentMethod)) {
            res.status(400).json(errorResponse('Invalid payment method', 400));
            return;
        }

        const plan = PRICING[planType];

        if (paymentMethod === 'stripe') {
            const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
            if (!stripeSecretKey) {
                res.status(503).json(errorResponse('Stripe is not configured', 503));
                return;
            }

            const stripe = new Stripe(stripeSecretKey);
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            product_data: {
                                name: `DocFlow AI - ${plan.title}`,
                                description: 'Unlock premium AI formatting'
                            },
                            unit_amount: Math.round(plan.amountUSD * 100)
                        },
                        quantity: 1
                    }
                ],
                mode: 'payment',
                success_url: `${getFrontendUrl()}?payment=success`,
                cancel_url: `${getFrontendUrl()}?payment=cancelled`,
                customer_email: user.email,
                metadata: { userId: user.id, planType, paymentMethod: 'stripe' }
            });

            await prisma.order.create({
                data: {
                    id: session.id,
                    userId: user.id,
                    amount: plan.amountUSD,
                    currency: 'USD',
                    planType,
                    status: 'PENDING'
                }
            });

            res.json(successResponse({ paymentMethod: 'stripe', sessionId: session.id, url: session.url }, 'Checkout created'));
            return;
        }

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
            const outTradeNo = `DOCUFLOW_${Date.now()}_${user.id.substring(0, 8)}`;
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

            const outTradeNo = `WX_${Date.now()}_${user.id.substring(0, 8)}`;
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
        const outTradeNo = `QR_${Date.now()}_${user.id.substring(0, 8)}`;
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

router.post('/webhook/stripe', async (req: Request, res: Response): Promise<void> => {
    try {
        const sig = req.headers['stripe-signature'];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

        if (!webhookSecret || !stripeSecretKey || !sig) {
            res.status(400).json(errorResponse('Stripe webhook not configured correctly', 400));
            return;
        }

        const stripe = new Stripe(stripeSecretKey);
        let event: Stripe.Event;
        try {
            event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
        } catch (err: any) {
            res.status(400).json(errorResponse(`Invalid signature: ${err.message}`, 400));
            return;
        }

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object as Stripe.Checkout.Session;
            const userId = session.metadata?.userId;
            const planType = session.metadata?.planType as string | undefined;
            if (userId && planType) {
                await applyPaidOrder(session.id, userId, planType);
            }
        }

        res.json({ received: true });
    } catch (error) {
        console.error('Stripe webhook error:', error);
        res.status(500).json(errorResponse('Webhook processing failed', 500));
    }
});

router.all('/webhook/alipay', async (req: Request, res: Response): Promise<void> => {
    try {
        const alipayAppId = process.env.ALIPAY_APP_ID;
        const alipayPrivateKey = process.env.ALIPAY_PRIVATE_KEY;
        const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;

        if (!alipayAppId || !alipayPrivateKey || !alipayPublicKey) {
            res.status(503).send('fail');
            return;
        }

        const AlipayCtor: any = (AlipaySdk as any).default || (AlipaySdk as any).AlipaySdk || (AlipaySdk as any);
        const alipaySdk = new AlipayCtor({ appId: alipayAppId, privateKey: alipayPrivateKey, alipayPublicKey, signType: 'RSA2' });

        const params: any = req.method === 'POST' ? req.body : req.query;
        if (!alipaySdk.checkNotifySign(params)) {
            res.status(400).send('fail');
            return;
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
        if (!receivedSign || receivedSign !== calculatedSign) {
            respondWechatXml(res, false, 'Invalid sign');
            return;
        }

        if (data.return_code !== 'SUCCESS' || data.result_code !== 'SUCCESS') {
            respondWechatXml(res, true, 'IGNORE');
            return;
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
