// 一次性密码重置脚本
// 运行方式（在 backend 目录下）：node reset-password.mjs
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// 手动加载 .env
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '.env');
try {
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
    }
    console.log('[env] .env 加载成功');
} catch (e) {
    console.warn('[env] 未找到 .env，使用系统环境变量');
}

import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EMAIL = 'hanhaha312@gmail.com';
const NEW_PASSWORD = '123456';

try {
    const hash = await bcrypt.hash(NEW_PASSWORD, 10);
    const user = await prisma.user.update({
        where: { email: EMAIL },
        data: { passwordHash: hash },
        select: { id: true, email: true }
    });
    console.log(`✓ 密码已重置：${user.email}`);
} catch (err) {
    console.error('❌ 重置失败：', err.message);
} finally {
    await prisma.$disconnect();
}
