# DocuFlow AI Backend

DocuFlow AI 的后端服务层,提供用户认证、会员订阅管理、以及安全的 AI 接口转发服务。

## 📋 功能特性

- ✅ **用户认证**: JWT 令牌认证,bcrypt 密码加密
- ✅ **订阅管理**: 免费用户(每日3次) / Pro 会员(无限制)
- ✅ **AI 文档生成**: 安全的 Gemini API 代理,支持 SSE 流式响应
- ✅ **支付集成**: Stripe 支付处理和 Webhook 回调
- ✅ **数据库**: Prisma ORM + SQLite (开发) / PostgreSQL (生产)
- ✅ **类型安全**: 完整的 TypeScript 类型定义

## 🚀 快速开始

### 前置要求

- Node.js 18+ 
- npm 或 yarn

### 安装步骤

1. **安装依赖**
   ```bash
   cd backend
   npm install
   ```

2. **配置环境变量**
   ```bash
   npm run setup
   ```
   
   这个命令会:
   - 自动从前端 `.env.local` 复制 Gemini API Key
   - 生成随机的 JWT Secret
   - 创建 `.env` 文件

   或者手动创建 `.env` 文件:
   ```env
   DATABASE_URL="file:./dev.db"
   GOOGLE_API_KEY=your_gemini_api_key
   JWT_SECRET=your_random_secret_min_32_chars
   PORT=3001
   NODE_ENV=development
   FRONTEND_URL=http://localhost:5173
   ```

3. **初始化数据库**
   ```bash
   npx prisma migrate dev --name init
   npx prisma generate
   ```

4. **启动开发服务器**
   ```bash
   npm run dev
   ```

   服务器将在 `http://localhost:3001` 启动

5. **查看数据库** (可选)
   ```bash
   npm run prisma:studio
   ```

## 📡 API 接口文档

### 认证接口

#### POST /api/auth/register
注册新用户

**请求体:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**响应:**
```json
{
  "code": 201,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "subscriptionStatus": "FREE",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "message": "注册成功"
}
```

#### POST /api/auth/login
用户登录

**请求体:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**响应:**
```json
{
  "code": 200,
  "data": {
    "token": "jwt_token_here",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "subscriptionStatus": "FREE"
    }
  },
  "message": "登录成功"
}
```

#### GET /api/auth/me
获取当前用户信息 (需要认证)

**请求头:**
```
Authorization: Bearer <token>
```

**响应:**
```json
{
  "code": 200,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "subscriptionStatus": "FREE"
    },
    "remainingQuota": 3
  },
  "message": "获取用户信息成功"
}
```

### 文档生成接口

#### POST /api/generate
生成文档 (需要认证,受限流控制)

**请求头:**
```
Authorization: Bearer <token>
```

**请求体:**
```json
{
  "content": "文档内容...",
  "preset": "academic",
  "fileName": "document.docx",
  "styleConfig": { ... }
}
```

**响应:** Server-Sent Events (SSE)
```
data: {"text": "生成的HTML内容..."}
data: {"text": "更多内容..."}
data: {"done": true}
```

### 支付接口

#### POST /api/payment/create-checkout-session
创建支付会话 (需要认证)

**请求头:**
```
Authorization: Bearer <token>
```

**请求体:**
```json
{
  "planType": "monthly"
}
```

**响应:**
```json
{
  "code": 200,
  "data": {
    "sessionId": "stripe_session_id",
    "url": "https://checkout.stripe.com/..."
  },
  "message": "支付会话创建成功"
}
```

#### POST /api/webhook/stripe
Stripe Webhook 回调 (公开接口,需签名验证)

## 🗄️ 数据库结构

### User (用户表)
- `id`: UUID 主键
- `email`: 邮箱 (唯一)
- `passwordHash`: 密码哈希
- `subscriptionStatus`: FREE | PRO
- `subscriptionEndDate`: 会员到期时间
- `createdAt`: 创建时间
- `updatedAt`: 更新时间

### UsageLog (用量日志)
- `id`: UUID 主键
- `userId`: 用户ID (外键)
- `actionType`: 操作类型
- `presetUsed`: 使用的预设
- `tokenUsage`: Token 消耗
- `createdAt`: 创建时间

### Order (订单表)
- `id`: Stripe Session ID
- `userId`: 用户ID (外键)
- `amount`: 金额
- `currency`: 货币
- `planType`: 计划类型
- `status`: PENDING | PAID | FAILED
- `createdAt`: 创建时间

## 🔒 安全特性

- ✅ JWT 令牌认证,24小时有效期
- ✅ bcrypt 密码加密 (10 轮)
- ✅ CORS 跨域保护
- ✅ 请求体大小限制 (50MB)
- ✅ 安全响应头 (X-Frame-Options, X-XSS-Protection 等)
- ✅ Stripe Webhook 签名验证
- ✅ 环境变量隔离,API Key 不暴露给前端

## 📦 部署

### Vercel 部署

1. **安装 Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **登录 Vercel**
   ```bash
   vercel login
   ```

3. **部署**
   ```bash
   vercel
   ```

4. **配置环境变量**
   在 Vercel Dashboard 中配置:
   - `DATABASE_URL` (使用 Vercel Postgres)
   - `GOOGLE_API_KEY`
   - `JWT_SECRET`
   - `STRIPE_SECRET_KEY` (可选)
   - `STRIPE_WEBHOOK_SECRET` (可选)
   - `FRONTEND_URL`

5. **配置 Stripe Webhook**
   部署后,在 Stripe Dashboard 中添加 Webhook URL:
   ```
   https://your-app.vercel.app/api/webhook/stripe
   ```

### 生产环境数据库

Vercel 的 Serverless 环境不支持 SQLite,推荐使用:

- **Vercel Postgres** (推荐): https://vercel.com/docs/storage/vercel-postgres
- **Supabase**: https://supabase.com/
- **PlanetScale**: https://planetscale.com/

修改 `prisma/schema.prisma` 中的 `datasource`:
```prisma
datasource db {
  provider = "postgresql"  // 改为 postgresql
  url      = env("DATABASE_URL")
}
```

然后重新运行迁移:
```bash
npx prisma migrate deploy
```

## 🛠️ 开发命令

```bash
npm run dev              # 启动开发服务器 (热重载)
npm run build            # 编译 TypeScript
npm start                # 启动生产服务器
npm run prisma:generate  # 生成 Prisma Client
npm run prisma:migrate   # 运行数据库迁移
npm run prisma:studio    # 打开 Prisma Studio (数据库可视化)
npm run setup            # 初始化环境配置
```

## 📝 项目结构

```
backend/
├── prisma/
│   └── schema.prisma          # 数据库模型定义
├── scripts/
│   └── setup.js               # 环境配置脚本
├── src/
│   ├── config/
│   │   └── database.ts        # Prisma 客户端
│   ├── middleware/
│   │   ├── auth.ts            # JWT 认证中间件
│   │   └── rateLimit.ts       # 限流中间件
│   ├── routes/
│   │   ├── auth.ts            # 认证路由
│   │   ├── generate.ts        # 文档生成路由
│   │   └── payment.ts         # 支付路由
│   ├── types/
│   │   └── index.ts           # TypeScript 类型定义
│   ├── utils/
│   │   └── response.ts        # 响应工具函数
│   └── server.ts              # 主服务器文件
├── .env.example               # 环境变量模板
├── .gitignore
├── package.json
├── tsconfig.json
└── vercel.json                # Vercel 部署配置
```

## 🐛 故障排除

### 数据库连接失败
```bash
# 删除旧数据库并重新迁移
rm dev.db
npx prisma migrate dev --name init
```

### Prisma Client 未生成
```bash
npx prisma generate
```

### 端口被占用
修改 `.env` 中的 `PORT` 值

### Stripe Webhook 测试
使用 Stripe CLI 进行本地测试:
```bash
stripe listen --forward-to localhost:3001/api/webhook/stripe
```

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request!
