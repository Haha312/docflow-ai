const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('🚀 DocuFlow AI Backend Setup\n');

// 生成随机 JWT Secret
const jwtSecret = crypto.randomBytes(32).toString('hex');

// 读取前端的 API Key
let geminiApiKey = '';
const frontendEnvPath = path.join(__dirname, '../../.env.local');

if (fs.existsSync(frontendEnvPath)) {
    const frontendEnv = fs.readFileSync(frontendEnvPath, 'utf-8');
    const match = frontendEnv.match(/API_KEY=(.+)/);
    if (match) {
        geminiApiKey = match[1].trim();
        console.log('✅ 从前端 .env.local 读取到 Gemini API Key');
    }
}

if (!geminiApiKey) {
    console.log('⚠️  未找到前端 API Key,请手动配置 GOOGLE_API_KEY');
    geminiApiKey = 'your_gemini_api_key_here';
}

// 创建 .env 文件
const envContent = `# 数据库配置 (SQLite 本地文件)
DATABASE_URL="file:./dev.db"

# Google Gemini API Key (从前端自动复制)
GOOGLE_API_KEY=${geminiApiKey}

# JWT 密钥 (自动生成的随机字符串)
JWT_SECRET=${jwtSecret}

# Stripe 配置 (可选,暂时留空)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# 服务器配置
PORT=3001
NODE_ENV=development

# 前端地址 (用于 CORS)
FRONTEND_URL=http://localhost:5173
`;

const envPath = path.join(__dirname, '../.env');
fs.writeFileSync(envPath, envContent);

console.log('✅ 已创建 .env 文件');
console.log('✅ JWT_SECRET 已自动生成');
console.log('\n📋 下一步:');
console.log('  1. npm install');
console.log('  2. npx prisma migrate dev --name init');
console.log('  3. npm run dev\n');
