import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import AlipaySdk from 'alipay-sdk';
import { AuthRequest, CreateCheckoutRequest } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import { authenticate } from '../middleware/auth';
import prisma from '../config/database';

const router = Router();

// 定价配置 - 简化版
const PRICING: Record<string, { amountUSD: number, amountCNY: number, duration: number, title: string }> = {
    // Pro
    'pro_monthly': { amountUSD: 3.99, amountCNY: 29, duration: 30, title: 'Pro 专业版 (月付)' },
    'pro_yearly': { amountUSD: 39.99, amountCNY: 298, duration: 365, title: 'Pro 专业版 (年付)' },

    // Team
    'team_monthly': { amountUSD: 26.99, amountCNY: 199, duration: 30, title: '团队版 (月付)' },
    'team_yearly': { amountUSD: 269.99, amountCNY: 1999, duration: 365, title: '团队版 (年付)' }
};

/**
 * POST /api/payment/create-checkout-session
 * 创建支付会话 (支持 Stripe 和支付宝)
 */
router.post('/create-checkout-session', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('未认证', 401));
            return;
        }

        const { planType, paymentMethod = 'stripe' }: CreateCheckoutRequest = req.body;

        // 验证计划类型
        if (!planType || !PRICING[planType]) {
            res.status(400).json(errorResponse('无效的计划类型', 400));
            return;
        }

        // 验证支付方式
        if (!['stripe', 'alipay'].includes(paymentMethod)) {
            res.status(400).json(errorResponse('无效的支付方式', 400));
            return;
        }

        const plan = PRICING[planType];
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

        // ===== Stripe 支付 =====
        if (paymentMethod === 'stripe') {
            const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
            if (!stripeSecretKey) {
                res.status(503).json(errorResponse('Stripe 支付服务暂未配置', 503));
                return;
            }

            const stripe = new Stripe(stripeSecretKey);

            // 创建 Stripe Checkout Session
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            product_data: {
                                name: `DocFlow AI - ${plan.title}`,
                                description: '解锁高级AI排版功能'
                            },
                            unit_amount: Math.round(plan.amountUSD * 100)
                        },
                        quantity: 1
                    }
                ],
                mode: 'payment',
                success_url: `${frontendUrl}?payment=success`,
                cancel_url: `${frontendUrl}?payment=cancelled`,
                customer_email: user.email,
                metadata: {
                    userId: user.id,
                    planType: planType,
                    paymentMethod: 'stripe'
                }
            });

            // 创建待支付订单记录
            await prisma.order.create({
                data: {
                    id: session.id,
                    userId: user.id,
                    amount: plan.amountUSD,
                    currency: 'USD',
                    planType: planType,
                    status: 'PENDING'
                }
            });

            res.json(successResponse({
                paymentMethod: 'stripe',
                sessionId: session.id,
                url: session.url
            }, 'Stripe 支付会话创建成功'));
            return;
        }

        // ===== 支付宝支付 =====
        if (paymentMethod === 'alipay') {
            const alipayAppId = process.env.ALIPAY_APP_ID;
            const alipayPrivateKey = process.env.ALIPAY_PRIVATE_KEY;
            const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;

            if (!alipayAppId || !alipayPrivateKey || !alipayPublicKey) {
                res.status(503).json(errorResponse('支付宝支付服务暂未配置', 503));
                return;
            }

            // 初始化支付宝 SDK
            const alipaySdk: any = new (AlipaySdk as any)({
                appId: alipayAppId,
                privateKey: alipayPrivateKey,
                alipayPublicKey: alipayPublicKey,
                gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
                signType: 'RSA2'
            });

            // 生成订单号
            const outTradeNo = `DOCUFLOW_${Date.now()}_${user.id.substring(0, 8)}`;

            // 创建支付宝订单
            const formData = new alipaySdk.AlipayFormData();
            formData.setMethod('get');
            formData.addField('returnUrl', `${frontendUrl}?payment=success`);
            formData.addField('notifyUrl', `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhook/alipay`);
            formData.addField('bizContent', {
                outTradeNo: outTradeNo,
                productCode: 'FAST_INSTANT_TRADE_PAY',
                totalAmount: plan.amountCNY.toFixed(2),
                subject: `DocFlow AI - ${plan.title}`,
                body: '解锁高级AI排版功能',
                passbackParams: encodeURIComponent(JSON.stringify({
                    userId: user.id,
                    planType: planType
                }))
            });

            // 生成支付链接
            const result = await alipaySdk.exec(
                'alipay.trade.page.pay',
                {},
                { formData: formData }
            );

            // 创建待支付订单记录
            await prisma.order.create({
                data: {
                    id: outTradeNo,
                    userId: user.id,
                    amount: plan.amountCNY,
                    currency: 'CNY',
                    planType: planType,
                    status: 'PENDING'
                }
            });

            res.json(successResponse({
                paymentMethod: 'alipay',
                orderId: outTradeNo,
                url: result
            }, '支付宝支付订单创建成功'));
            return;
        }

    } catch (error) {
        console.error('Create checkout session error:', error);
        res.status(500).json(errorResponse('创建支付会话失败', 500));
    }
});

/**
 * POST /api/webhook/stripe
 * Stripe Webhook 处理
 */
router.post('/stripe', async (req: Request, res: Response): Promise<void> => {
    try {
        const sig = req.headers['stripe-signature'];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!webhookSecret) {
            console.warn('STRIPE_WEBHOOK_SECRET 未配置');
            res.status(503).json(errorResponse('Webhook 未配置', 503));
            return;
        }

        if (!sig) {
            res.status(400).json(errorResponse('缺少签名', 400));
            return;
        }

        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeSecretKey) {
            res.status(503).json(errorResponse('支付服务未配置', 503));
            return;
        }

        const stripe = new Stripe(stripeSecretKey);

        // 验证 webhook 签名
        let event: Stripe.Event;
        try {
            event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        } catch (err: any) {
            console.error('Webhook signature verification failed:', err.message);
            res.status(400).json(errorResponse('签名验证失败', 400));
            return;
        }

        // 处理支付成功事件
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object as Stripe.Checkout.Session;
            const userId = session.metadata?.userId;
            const planType = session.metadata?.planType as 'monthly' | 'yearly';

            if (!userId || !planType) {
                console.error('Missing metadata in session:', session.id);
                res.status(400).json(errorResponse('缺少元数据', 400));
                return;
            }

            // 更新订单状态
            await prisma.order.update({
                where: { id: session.id },
                data: { status: 'PAID' }
            });

            // 更新用户订阅状态
            const plan = PRICING[planType];
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + plan.duration);

            // Determine Tier
            let tier: 'PRO' | 'TEAM' = 'PRO';
            if (planType.includes('team')) tier = 'TEAM';

            await prisma.user.update({
                where: { id: userId },
                data: {
                    subscriptionStatus: tier,
                    subscriptionEndDate: endDate
                }
            });

            console.log(`✅ User ${userId} upgraded to PRO via Stripe (${planType})`);
        }

        res.json({ received: true });

    } catch (error) {
        console.error('Stripe webhook error:', error);
        res.status(500).json(errorResponse('Webhook 处理失败', 500));
    }
});

/**
 * GET/POST /api/webhook/alipay
 * 支付宝异步通知处理
 */
router.all('/alipay', async (req: Request, res: Response): Promise<void> => {
    try {
        const alipayAppId = process.env.ALIPAY_APP_ID;
        const alipayPrivateKey = process.env.ALIPAY_PRIVATE_KEY;
        const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;

        if (!alipayAppId || !alipayPrivateKey || !alipayPublicKey) {
            res.status(503).send('fail');
            return;
        }

        const alipaySdk: any = new (AlipaySdk as any)({
            appId: alipayAppId,
            privateKey: alipayPrivateKey,
            alipayPublicKey: alipayPublicKey,
            signType: 'RSA2'
        });

        // 获取通知参数 (支持 GET 和 POST)
        const params = req.method === 'POST' ? req.body : req.query;

        // 验证签名
        const signVerified = alipaySdk.checkNotifySign(params);

        if (!signVerified) {
            console.error('Alipay signature verification failed');
            res.status(400).send('fail');
            return;
        }

        // 获取交易状态
        const tradeStatus = params.trade_status;
        const outTradeNo = params.out_trade_no;

        // 支付成功
        if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
            // 解析回传参数
            const passbackParams = JSON.parse(decodeURIComponent(params.passback_params || '{}'));
            const userId = passbackParams.userId;
            const planType = passbackParams.planType as 'monthly' | 'yearly';

            if (!userId || !planType) {
                console.error('Missing passback params in Alipay notification');
                res.send('success'); // 仍然返回 success 避免支付宝重复通知
                return;
            }

            // 检查订单是否已处理
            const existingOrder = await prisma.order.findUnique({
                where: { id: outTradeNo }
            });

            if (existingOrder && existingOrder.status === 'PAID') {
                console.log(`Order ${outTradeNo} already processed`);
                res.send('success');
                return;
            }

            // 更新订单状态
            await prisma.order.update({
                where: { id: outTradeNo },
                data: { status: 'PAID' }
            });

            // 更新用户订阅状态
            const plan = PRICING[planType];
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + plan.duration);

            // Determine Tier
            let tier: 'PRO' | 'TEAM' = 'PRO';
            if (planType.includes('team')) tier = 'TEAM';

            await prisma.user.update({
                where: { id: userId },
                data: {
                    subscriptionStatus: tier,
                    subscriptionEndDate: endDate
                }
            });

            console.log(`✅ User ${userId} upgraded to PRO via Alipay (${planType})`);
        }

        // 返回 success 给支付宝
        res.send('success');

    } catch (error) {
        console.error('Alipay webhook error:', error);
        res.status(500).send('fail');
    }
});

export default router;
