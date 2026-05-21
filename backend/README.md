# DocuFlow AI Backend

DocuFlow AI 的后端服务层,提供用户认证、会员订阅管理、以及安全的 AI 接口转发服务。

## 📋 功能特性

- ✅ **用户认证**: JWT 令牌认证,bcrypt 密码加密
- ✅ **订阅管理**: 免费用户(每日3次) / Pro 会员(无限制)
- ✅ **AI 文档生成**: 安全的 Gemini API 代理,支持 SSE 流式响应
- ✅ **支付集成**: Stripe 支付处理和 Webhook 回调
- ✅ **数据库**: Prisma ORM + Supabase PostgreSQL (开发与生产统一)
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

2. **创建 Supabase 项目**
   - 前往 https://supabase.com 注册并新建项目
   - Region 选 **Southeast Asia (Singapore)** (国内/香港访问最快)
   - 设置数据库密码并妥善保管
   - 进入 Settings → Database → Connection string → URI,复制 **Direct connection** (端口 5432) 的 URL

3. **配置环境变量**
   ```bash
   npm run setup
   ```
   
   该命令会创建 `.env` 模板。然后编辑 `backend/.env`,把 `DATABASE_URL` 替换为上一步复制的 Supabase 连接串(记得替换 `[YOUR-PASSWORD]`)。

4. **初始化数据库**
   ```bash
   npx prisma migrate deploy   # 应用所有迁移到 Supabase
   npx prisma generate          # 生成 Prisma Client
   node scripts/seed-admin.js   # 创建管理员账号
   ```

5. **启动开发服务器**
   ```bash
   npm run dev
   ```

   服务器将在 `http://localhost:3001` 启动。启动时会看到 `[db] Connected to PostgreSQL`,表示数据库连接成功。

6. **查看数据库** (可选)
   - Supabase Dashboard → Table Editor (网页可视化)
   - 或本地 `npm run prisma:studio`

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

本项目使用 **Supabase PostgreSQL**,开发和生产环境复用同一套 schema/migrations,无需为部署单独调整。

部署时只需:
1. 在线上服务器上配置 `DATABASE_URL` 环境变量(指向同一个 Supabase 项目,或为生产单独建一个项目)
2. 执行 `npx prisma migrate deploy` 应用迁移
3. 启动服务

**部署平台建议**:
- 香港 / 新加坡 / 日本 节点的 VPS (访问 Supabase Singapore 延迟 < 50ms)
- 长期运行容器:Render / Railway / Fly.io (推荐 Singapore 区域)
- Serverless 平台:Vercel / Cloudflare Workers (需将 `DATABASE_URL` 改为 Supabase 的 **Transaction Pooler** URL,端口 6543)

⚠️ **国内云主机访问 Supabase 会有 200-500ms 延迟且不稳定,不推荐**。

### 从旧版 SQLite 迁移数据

如果你之前用过 SQLite (`prisma/dev.db`),迁移到 Supabase:
```bash
# 1. 备份旧库
cp prisma/dev.db prisma/dev.db.backup

# 2. 配置好 .env 的 DATABASE_URL 后,创建目标表
npx prisma migrate deploy

# 3. 安装一次性依赖
npm install --no-save better-sqlite3 @types/better-sqlite3

# 4. 执行迁移(首次跑可加 RESET_TARGET=1 清空目标)
RESET_TARGET=1 npx tsx scripts/migrate-sqlite-to-supabase.ts
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
启动时报 `[db] Failed to connect to PostgreSQL` 通常是以下原因:

1. **DATABASE_URL 密码错误** — 重新检查 `.env`,确认 `[YOUR-PASSWORD]` 已替换为真实密码且不含特殊字符未转义
2. **Supabase 项目已暂停** — 免费层闲置 7 天会自动暂停,登录 Dashboard 点 "Restore Project"
3. **IP 被网络限制拦截** — Supabase Dashboard → Settings → Database → Network Restrictions,确认允许你的 IP (开发期可设 `0.0.0.0/0`,生产期收紧到 VPS IP)
4. **国内网络问题** — Supabase 在境外,国内直连可能不稳。换香港/新加坡 VPS

测试连接命令:
```bash
npx prisma db pull   # 能拉取 schema 说明连接 OK
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
