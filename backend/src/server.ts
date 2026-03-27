import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import generateRoutes from './routes/generate';
import paymentRoutes from './routes/payment';
import userRoutes from './routes/user';
import documentRoutes from './routes/document';
import adminRoutes from './routes/admin';
import { errorResponse } from './utils/response';

dotenv.config();

console.log('DocuFlow Backend Restarting...');
if (process.env.NODE_ENV !== 'production') {
    console.log('DEBUG: GEMINI_OPENAI_BASE_URL configured =', !!process.env.GEMINI_OPENAI_BASE_URL);
    console.log('DEBUG: GOOGLE_API_KEY configured =', !!process.env.GOOGLE_API_KEY);
}

const app = express();
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

if (process.env.NODE_ENV === 'development') {
    app.use((req: Request, _res: Response, next: NextFunction) => {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
        next();
    });
}

app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.get('/health', (_req: Request, res: Response) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

app.use('/api/auth', authRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/documents', documentRoutes);

app.use((_req: Request, res: Response) => {
    res.status(404).json(errorResponse('接口不存在', 404));
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json(errorResponse('服务器内部错误', 500));
});

export default app;

if (!process.env.VERCEL) {
    app.listen(Number(PORT), '0.0.0.0', () => {
        console.log('\nDocuFlow AI Backend Server');
        console.log('================================');
        console.log(`Server running on: http://localhost:${PORT}`);
        console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
        console.log(`Health check: http://localhost:${PORT}/health`);
        console.log('================================\n');
    });
}


