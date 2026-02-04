import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import AlipaySdk from 'alipay-sdk';
import * as fs from 'fs';
import * as path from 'path';
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
        if (!['stripe', 'alipay', 'qrcode'].includes(paymentMethod)) {
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
            // Public Key is optional if using Cert Mode
            const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;

            // Certificate Paths
            const certDir = path.join(process.cwd(), 'Alipay');
            const alipayRootCertPath = path.join(certDir, 'alipayRootCert.crt');
            const alipayPublicCertPath = path.join(certDir, 'alipayCertPublicKey_RSA2.crt');
            // Allow dynamic finding of App Cert (contains AppID)
            const appCertFiles = fs.existsSync(certDir) ? fs.readdirSync(certDir).filter(f => f.startsWith('appCertPublicKey_') && f.endsWith('.crt')) : [];
            const appCertPath = appCertFiles.length > 0 ? path.join(certDir, appCertFiles[0]) : null;

            // Determine Validity (Key Mode OR Cert Mode)
            const hasKeyMode = alipayAppId && alipayPrivateKey && alipayPublicKey;
            const hasCertMode = alipayPrivateKey && appCertPath && fs.existsSync(alipayRootCertPath) && fs.existsSync(alipayPublicCertPath);

            console.log('Payment Debug:', { hasKeyMode, hasCertMode, appCertPath, certDir });

            // 检查配置，如果不完整则进入模拟模式
            if (!hasKeyMode && !hasCertMode) {
                // MOCK MODE (Face-to-Face Style)
                console.log('Alipay keys/certs missing, initializing MOCK F2F payment mode.');
                const outTradeNo = `MOCK_${Date.now()}_${user.id.substring(0, 8)}`;

                const mockQrCode = `https://docuflow.ai/pay/mock/${outTradeNo}`;

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
                    qrCode: mockQrCode,
                    isMock: true
                }, '模拟支付宝当面付订单创建成功'));
                return;
            }

            // 初始化支付宝 SDK
            let alipaySdk: any;

            try {
                // Fix for Import issue: handle default export, named export, and require fallback
                let AlipaySdkConstructor = AlipaySdk;
                let pkg: any = AlipaySdk; // Start by assuming imports worked

                // 1. Try .default from standard import
                if ((AlipaySdk as any)?.default) {
                    pkg = (AlipaySdk as any).default;
                    AlipaySdkConstructor = pkg;
                }

                // 2. Try .AlipaySdk (named export) from standard import or derived pkg
                if ((AlipaySdk as any)?.AlipaySdk) {
                    AlipaySdkConstructor = (AlipaySdk as any).AlipaySdk;
                } else if (pkg?.AlipaySdk) {
                    AlipaySdkConstructor = pkg.AlipaySdk;
                }

                // 3. If not a function yet, try dynamic require
                if (typeof AlipaySdkConstructor !== 'function') {
                    try {
                        console.log('AlipaySdk import was not a constructor, trying dynamic require...');
                        pkg = require('alipay-sdk');
                        // Try default, then named export, then the package itself
                        AlipaySdkConstructor = pkg.default || pkg.AlipaySdk || pkg;
                    } catch (e) {
                        console.error('Dynamic require failed:', e);
                    }
                }

                console.log('Resolved AlipaySdkConstructor:', AlipaySdkConstructor);

                if (typeof AlipaySdkConstructor !== 'function') {
                    throw new Error(`AlipaySdk is not a constructor (type: ${typeof AlipaySdkConstructor}). Available keys: ${Object.keys(AlipaySdkConstructor || {})}`);
                }

                if (hasCertMode && appCertPath) {
                    // Certificate Mode
                    // Extract AppID from filename if not provided in env: appCertPublicKey_2021006130670626.crt
                    const certAppId = alipayAppId || path.basename(appCertPath).split('_')[1].split('.')[0];

                    console.log(`Initializing Alipay SDK in CERT MODE (AppID: ${certAppId})`);

                    alipaySdk = new AlipaySdkConstructor({
                        appId: certAppId,
                        privateKey: alipayPrivateKey,
                        alipayRootCertPath: alipayRootCertPath,
                        alipayPublicCertPath: alipayPublicCertPath,
                        appCertPath: appCertPath,
                        gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
                        signType: 'RSA2'
                    });
                } else {
                    // Key Mode
                    console.log(`Initializing Alipay SDK in KEY MODE`);
                    alipaySdk = new AlipaySdkConstructor({
                        appId: alipayAppId,
                        privateKey: alipayPrivateKey,
                        alipayPublicKey: alipayPublicKey,
                        gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
                        signType: 'RSA2'
                    });
                }
            } catch (initError: any) {
                const errorMsg = `Alipay SDK Init Error: ${initError.message}\nStack: ${initError.stack}\n`;
                console.error(errorMsg);
                fs.appendFileSync(path.join(process.cwd(), 'payment_error.log'), `${new Date().toISOString()} - ${errorMsg}\n`);
                throw new Error('支付宝 SDK 初始化失败: ' + initError.message);
            }

            // 生成订单号
            const outTradeNo = `DOCUFLOW_${Date.now()}_${user.id.substring(0, 8)}`;

            // 构造支付宝请求参数 (使用普通对象，不再使用 AlipayFormData)
            // alipay.trade.precreate 不需要 multipart/form-data
            const bizContent = {
                outTradeNo: outTradeNo,
                totalAmount: plan.amountCNY.toFixed(2),
                subject: `DocFlow AI - ${plan.title}`,
                body: '解锁高级AI排版功能',
                passbackParams: encodeURIComponent(JSON.stringify({
                    userId: user.id,
                    planType: planType
                }))
            };

            const params = {
                bizContent: bizContent,
                notifyUrl: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhook/alipay`
            };

            console.log('Sending request to Alipay (Plain Object Mode)...');

            // 调用当面付接口
            let result;
            try {
                result = await alipaySdk.exec(
                    'alipay.trade.precreate',
                    params
                );
            } catch (execError: any) {
                console.error('Alipay Exec Error:', execError);
                // Print detailed response if available
                if (execError.serverResult) {
                    console.error('Alipay Server Result:', JSON.stringify(execError.serverResult));
                }
                throw new Error('支付宝接口调用失败: ' + execError.message);
            }

            console.log('Real Alipay Precreate Result:', result);

            // Check for Alipay Business Logic Errors (e.g., App Not Online)
            if (result.code !== '10000') {
                const errorMsg = result.subMsg || result.msg || '支付宝创建订单失败';
                console.error(`Alipay API Failed: ${result.code} - ${errorMsg}`);
                throw new Error(`支付宝接口错误: ${errorMsg}`);
            }

            if (!result.qr_code) {
                console.error('Missing qr_code in result:', result);
                throw new Error('支付宝返回数据异常: 缺少二维码');
            }

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
                qrCode: result.qr_code
            }, '支付宝当面付订单创建成功'));
            return;
        }

        // ===== 个人收款码支付 =====
        if (paymentMethod === 'qrcode') {
            const outTradeNo = `QR_${Date.now()}_${user.id.substring(0, 8)}`;

            // Create PENDING order
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
                paymentMethod: 'qrcode',
                orderId: outTradeNo,
                amount: plan.amountCNY,
                alipayQrUrl: '/api/payment/qrcode-image?type=alipay',
                wechatQrUrl: '/api/payment/qrcode-image?type=wechat'
            }, '订单创建成功，请扫码支付'));
            return;
        }

    } catch (error) {
        console.error('Create checkout session error:', error);
        res.status(500).json(errorResponse('创建支付会话失败', 500));
    }
});

/**
 * GET /api/payment/mock-alipay-gateway
 * 模拟支付宝支付页面
 */
router.get('/mock-alipay-gateway', async (req: Request, res: Response) => {
    const { outTradeNo, amount, returnUrl } = req.query;

    // Check if we need to update order status here? 
    // Usually Gateway just redirects. Real webhook updates status. 
    // For mock, let's update status right here or assume success.
    // To be proper, we should update the order to PAID here since there is no callback.

    if (typeof outTradeNo === 'string') {
        const order = await prisma.order.findUnique({ where: { id: outTradeNo } });
        if (order && order.status === 'PENDING') {
            await prisma.order.update({
                where: { id: outTradeNo },
                data: { status: 'PAID' }
            });
            // Update user status
            const plan = Object.values(PRICING).find(p => p.amountCNY === order.amount || p.amountUSD === order.amount); // loose match
            // Better: store plan details in order. Oh wait order has planType.
            if (order.planType && PRICING[order.planType]) {
                const p = PRICING[order.planType];
                const endDate = new Date();
                endDate.setDate(endDate.getDate() + p.duration);
                let tier: 'PRO' | 'TEAM' = order.planType.includes('team') ? 'TEAM' : 'PRO';

                await prisma.user.update({
                    where: { id: order.userId },
                    data: { subscriptionStatus: tier, subscriptionEndDate: endDate }
                });
            }
        }
    }

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>支付宝支付 (模拟)</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f5f5f5; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: white; padding: 40px; border-radius: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
            .logo { width: 80px; height: 80px; margin-bottom: 20px; }
            .amount { font-size: 40px; font-weight: bold; color: #333; margin: 20px 0; }
            .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #1677ff; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 20px; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            p { color: #666; margin-bottom: 30px; }
            .btn { background: #1677ff; color: white; border: none; padding: 12px 30px; border-radius: 8px; font-size: 16px; cursor: pointer; text-decoration: none; display: inline-block; }
        </style>
    </head>
    <body>
        <div class="card">
            <img src="https://img.alicdn.com/tfs/TB1e0.5w4n1gK0jSZKPXXbDwXXa-200-200.png" class="logo" />
            <h2>DocFlow AI 收银台</h2>
            <div class="amount">¥${amount}</div>
            <div class="spinner"></div>
            <p>正在连接支付宝安全网关...</p>
            <p style="font-size: 12px; color: #999;">(开发环境模拟支付模式)</p>
        </div>
        <script>
            setTimeout(() => {
                window.location.href = "${returnUrl || '/'}";
            }, 3000);
        </script>
    </body>
    </html>
    `;

    res.send(html);
});

/**
 * POST /api/payment/confirm-by-amount
 * Confirm payment by matching amount to pending orders
 * Body: { monum: number }
 */
router.post('/confirm-by-amount', async (req: Request, res: Response): Promise<void> => {
    try {
        const { monum } = req.body;

        if (monum === undefined || monum === null) {
            res.status(400).json(errorResponse('Missing monum parameter', 400));
            return;
        }

        const amount = parseFloat(monum);
        if (isNaN(amount)) {
            res.status(400).json(errorResponse('Invalid monum value', 400));
            return;
        }

        // Find oldest PENDING order with matching amount
        const order = await prisma.order.findFirst({
            where: {
                status: 'PENDING',
                amount: amount
            },
            orderBy: { createdAt: 'asc' }
        });

        if (!order) {
            res.status(404).json(errorResponse('No pending order matches this amount', 404));
            return;
        }

        // Update order to PAID
        await prisma.order.update({
            where: { id: order.id },
            data: { status: 'PAID' }
        });

        // Update user subscription
        const planConfig = PRICING[order.planType];
        if (planConfig) {
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + planConfig.duration);

            let tier: 'PRO' | 'TEAM' = 'PRO';
            if (order.planType.includes('team')) tier = 'TEAM';

            await prisma.user.update({
                where: { id: order.userId },
                data: {
                    subscriptionStatus: tier,
                    subscriptionEndDate: endDate
                }
            });

            console.log(`✅ Payment confirmed for order ${order.id}, user upgraded to ${tier}`);
        }

        res.json(successResponse({ orderId: order.id, userId: order.userId }, 'Payment confirmed'));
    } catch (error) {
        console.error('Confirm by amount error:', error);
        res.status(500).json(errorResponse('Failed to confirm payment', 500));
    }
});

/**
 * GET /api/payment/qrcode-image
 * Returns the merchant's personal payment QR code image
 * Query: type=alipay|wechat (default: alipay)
 */
router.get('/qrcode-image', (req: Request, res: Response): void => {
    const type = (req.query.type as string) || 'alipay';

    // Map type to image file
    const imageMap: Record<string, string> = {
        'alipay': 'Alipay.jpg',
        'wechat': 'wechat.png'
    };

    const fileName = imageMap[type] || imageMap['alipay'];
    // Images are stored in frontend/image directory
    const imagePath = path.join(process.cwd(), '..', 'frontend', 'image', fileName);

    if (fs.existsSync(imagePath)) {
        res.sendFile(imagePath);
    } else {
        res.status(404).json(errorResponse(`QR code image not found: ${fileName}`, 404));
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
