import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import generateRoutes from './routes/generate';
import paymentRoutes from './routes/payment';
import userRoutes from './routes/user';
import documentRoutes from './routes/document';
import { errorResponse } from './utils/response';

// 加载环境变量
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ===== 中间件配置 =====

// CORS 配置
const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Stripe Webhook 需要原始请求体,所以在这里特殊处理
app.use('/api/webhook/stripe', express.raw({ type: 'application/json' }));

// JSON 解析中间件
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 请求日志中间件 (开发环境)
if (process.env.NODE_ENV === 'development') {
    app.use((req: Request, res: Response, next: NextFunction) => {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
        next();
    });
}

// 安全头部
app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// ===== 路由配置 =====

// 健康检查
app.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/payment', paymentRoutes);

// 404 处理
app.use((req: Request, res: Response) => {
    res.status(404).json(errorResponse('接口不存在', 404));
});

// 全局错误处理
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json(errorResponse('服务器内部错误', 500));
});

// ===== 启动服务器 =====

// Vercel 需要导出 app
export default app;

// 仅在本地非 Vercel 环境启动监听
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log('\n🚀 DocuFlow AI Backend Server');
        console.log('================================');
        console.log(`📡 Server running on: http://localhost:${PORT}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
        console.log(`✅ Health check: http://localhost:${PORT}/health`);
        console.log('================================\n');
    });
}
