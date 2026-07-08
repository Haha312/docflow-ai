const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('🚀 DocFlow Backend Setup\n');

const envPath = path.join(__dirname, '../.env');

if (fs.existsSync(envPath)) {
    console.log('⚠️  .env 已存在,跳过生成。如需重建,请先删除 backend/.env');
    process.exit(0);
}

// 生成随机 JWT Secret
const jwtSecret = crypto.randomBytes(32).toString('hex');

// 尝试从前端 .env.local 读取 Gemini API Key
let geminiApiKey = 'your_gemini_api_key_here';
const frontendEnvPath = path.join(__dirname, '../../.env.local');

if (fs.existsSync(frontendEnvPath)) {
    const frontendEnv = fs.readFileSync(frontendEnvPath, 'utf-8');
    const match = frontendEnv.match(/API_KEY=(.+)/);
    if (match) {
        geminiApiKey = match[1].trim();
        console.log('✅ 从前端 .env.local 读取到 Gemini API Key');
    }
}

if (geminiApiKey === 'your_gemini_api_key_here') {
    console.log('⚠️  未找到前端 API Key,请手动配置 GOOGLE_API_KEY');
}

const envContent = `# ============ 数据库 (Supabase PostgreSQL) ============
# !! 必填 !! 从 Supabase Dashboard → Settings → Database → Connection string → URI
# 使用 "Direct connection" (端口 5432),把 [YOUR-PASSWORD] 替换为你设置的数据库密码
DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres?sslmode=require"

# ============ AI 模型 ============
GOOGLE_API_KEY=${geminiApiKey}
GEMINI_MODEL=gemini-3-pro-preview

# ============ 鉴权 ============
JWT_SECRET=${jwtSecret}
ADMIN_EMAILS=admin@docuflow.ai

# ============ 支付 (可选) ============
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
ALIPAY_APP_ID=
ALIPAY_PRIVATE_KEY=
ALIPAY_PUBLIC_KEY=
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do

# ============ 服务器 ============
PORT=3001
NODE_ENV=development
BACKEND_URL=http://localhost:3001
FRONTEND_URL=http://localhost:5173
`;

fs.writeFileSync(envPath, envContent);

console.log('✅ 已创建 backend/.env');
console.log('✅ JWT_SECRET 已自动生成');
console.log('\n📋 下一步:');
console.log('  1. 编辑 backend/.env,把 DATABASE_URL 替换为你的 Supabase 连接串');
console.log('  2. npm install');
console.log('  3. npx prisma migrate deploy        # 应用数据库迁移');
console.log('  4. node scripts/seed-admin.js       # 创建管理员账号');
console.log('  5. npm run dev                      # 启动后端\n');
