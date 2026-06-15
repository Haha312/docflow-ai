import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pinoHttp from 'pino-http';
import authRoutes from './routes/auth';
import generateRoutes from './routes/generate';
import paymentRoutes from './routes/payment';
import userRoutes from './routes/user';
import adminRoutes from './routes/admin';
import { errorResponse } from './utils/response';
import logger from './utils/logger';
import { startPaymentReconciliationJob, stopPaymentReconciliationJob } from './services/paymentReconciliation';
import { startRenewalReminderJob, stopRenewalReminderJob } from './services/renewalReminderJob';
import prisma from './config/database';
import redis from './utils/redis';

dotenv.config();

console.log('DocuFlow Backend Restarting...');
if (process.env.NODE_ENV !== 'production') {
    console.log('DEBUG: GEMINI_OPENAI_BASE_URL configured =', !!process.env.GEMINI_OPENAI_BASE_URL);
    console.log('DEBUG: GOOGLE_API_KEY configured =', !!process.env.GOOGLE_API_KEY);
}

// 生产环境启动时校验必需 env,缺失立即退出(fail-fast),不留到运行时才暴露。
function validateProductionEnv(): void {
    if (process.env.NODE_ENV !== 'production') return;
    const required: Record<string, string | undefined> = {
        JWT_SECRET: process.env.JWT_SECRET,
        DATABASE_URL: process.env.DATABASE_URL,
        REDIS_URL: process.env.REDIS_URL,
        BACKEND_URL: process.env.BACKEND_URL,
        // 手机登录核心:腾讯云短信
        TENCENTCLOUD_SECRET_ID: process.env.TENCENTCLOUD_SECRET_ID,
        TENCENTCLOUD_SECRET_KEY: process.env.TENCENTCLOUD_SECRET_KEY,
        TENCENT_SMS_SDK_APP_ID: process.env.TENCENT_SMS_SDK_APP_ID,
        TENCENT_SMS_SIGN_NAME: process.env.TENCENT_SMS_SIGN_NAME,
        TENCENT_SMS_TEMPLATE_ID: process.env.TENCENT_SMS_TEMPLATE_ID,
    };
    const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
    if (!process.env.CORS_ORIGINS && !process.env.FRONTEND_URL) missing.push('CORS_ORIGINS (或 FRONTEND_URL)');
    if (missing.length) {
        console.error('[FATAL] 生产环境缺少必需环境变量,无法启动:\n  - ' + missing.join('\n  - ') + '\n请参照 backend/.env.example 配置后重启。');
        process.exit(1);
    }
}
validateProductionEnv();

// 进程级异常兜底:未捕获异常/拒绝只记日志,避免单个异步错误打挂整个进程切断所有 SSE 连接。
process.on('uncaughtException', (err) => logger.error({ err }, 'uncaughtException'));
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandledRejection'));

const app = express();
// 按部署的反代层数信任 X-Forwarded-For(nginx 单层=1),让 req.ip 取到可信客户端 IP。
// 不设的话限流可被伪造 XFF 头绕过。
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
const PORT = process.env.PORT || 3001;
const BODY_LIMIT = process.env.BODY_LIMIT || '100mb';
const rawOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
const allowedOrigins = new Set(rawOrigins);
console.log('DEBUG: Allowed CORS Origins:', Array.from(allowedOrigins));

const corsOptions = {
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        if (!origin) return callback(null, true);

        const normalizedOrigin = origin.replace(/\/+$/, '');
        if (allowedOrigins.size === 0) {
            // Without an explicit whitelist, only allow all in non-production envs.
            return callback(null, process.env.NODE_ENV !== 'production');
        }

        return callback(null, allowedOrigins.has(normalizedOrigin));
    },
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// WeChat Pay callback posts XML body
app.use('/api/webhook/wechat', express.text({ type: '*/*' }));
app.use('/api/payment/webhook/wechat', express.text({ type: '*/*' }));

app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// Structured request logging (replaces ad-hoc console.log)
app.use(
    pinoHttp({
        logger,
        autoLogging: {
            // Don't log health checks — they spam the logs
            ignore: (req) => req.url === '/health',
        },
        customLogLevel: (_req, res, err) => {
            if (err || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
        },
    })
);

// Content-Security-Policy allowlist。
// 生产用硬模式;开发用 Report-Only 以避免挡 Vite HMR / Supabase WebSocket。
// 若用户群在欧盟,可改成更严格的 nonce-based 配置。
//
// connect-src 覆盖前端需要直连的服务:Supabase、各 AI 模型 API(国内模型走后端代理,
// 所以前端只需连自己的后端,但保留这些以防未来前端直连)。dev 额外允许 localhost ws(Vite HMR)。
const buildCsp = (isDev: boolean): string => {
    const connectSrc = [
        "'self'",
        'https://*.supabase.co',
        'https://generativelanguage.googleapis.com',
        'https://api.deepseek.com',
        'https://ark.cn-beijing.volces.com',
        'https://dashscope.aliyuncs.com',
        ...(isDev ? ['ws://localhost:*', 'http://localhost:*'] : []),
    ].join(' ');
    return [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data: https://fonts.gstatic.com",
        `connect-src ${connectSrc}`,
    ].join('; ');
};

app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Content-Security-Policy', buildCsp(false));
        // 仅 HTTPS 部署后启用 HSTS;若未启用 HTTPS 会让所有用户被锁定 https://
        if (process.env.ENABLE_HSTS === 'true') {
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }
    } else {
        // Dev 用 Report-Only 模式,违规只 console 警告,不阻断
        res.setHeader('Content-Security-Policy-Report-Only', buildCsp(true));
    }
    next();
});

app.get('/health', (_req: Request, res: Response) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// 就绪探针:校验 DB + Redis 真正可用(/health 只是存活)。任一不可用返回 503。
app.get('/ready', async (_req: Request, res: Response) => {
    const checks = { db: false, redis: false };
    try { await prisma.$queryRaw`SELECT 1`; checks.db = true; } catch { /* down */ }
    try { await redis.set('ready:probe', '1', 'EX', 5); checks.redis = true; } catch { /* down */ }
    const ok = checks.db && checks.redis;
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'not-ready', checks });
});

app.use('/api/auth', authRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);

app.use((_req: Request, res: Response) => {
    res.status(404).json(errorResponse('接口不存在', 404));
});

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    // req.log is attached by pino-http and includes request context (method, url, requestId)
    (req as Request & { log?: typeof logger }).log?.error({ err }, 'Unhandled error');
    logger.error({ err }, 'Unhandled error (no request context)');
    res.status(500).json(errorResponse('服务器内部错误', 500));
});

export default app;

if (!process.env.VERCEL) {
    const server = app.listen(Number(PORT), '0.0.0.0', () => {
        console.log('\nDocuFlow AI Backend Server');
        console.log('================================');
        console.log(`Server running on: http://localhost:${PORT}`);
        console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
        console.log(`Health check: http://localhost:${PORT}/health`);
        console.log('================================\n');

        // Background jobs (single-instance only — needs a Redis lock if scaled horizontally)
        startPaymentReconciliationJob();
        startRenewalReminderJob();
    });

    // 优雅关闭:停定时任务 → 排空在途请求 → 断开 DB,10s 超时强制退出。
    let shuttingDown = false;
    const shutdown = (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`\n[shutdown] received ${signal}, closing gracefully...`);
        stopPaymentReconciliationJob();
        stopRenewalReminderJob();
        server.close(() => {
            prisma.$disconnect().finally(() => process.exit(0));
        });
        setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}


