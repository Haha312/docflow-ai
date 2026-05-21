const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('dotenv').config();

/**
 * 创建初始管理员账号。
 *
 * 配置(全部可选):
 *   ADMIN_EMAIL     管理员邮箱 (默认 admin@docuflow.ai)
 *   ADMIN_PASSWORD  管理员密码 (推荐通过环境变量传入。未设置则自动生成 24 字符强随机密码并打印一次)
 *
 * 安全说明:
 *   - 不再硬编码任何默认密码
 *   - 自动生成的密码只显示一次,丢失后需删除账号重建
 *   - 创建后请尽快登录修改为你记得的密码
 */
async function seedAdmin() {
    const prisma = new PrismaClient();

    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@docuflow.ai').trim().toLowerCase();
    let adminPassword = process.env.ADMIN_PASSWORD;
    let passwordWasGenerated = false;

    if (!adminPassword) {
        // 生成 24 字节 base64url 密码 (~32 字符),熵 ≈ 192 bit
        adminPassword = crypto.randomBytes(24).toString('base64url');
        passwordWasGenerated = true;
    } else if (adminPassword.length < 12) {
        console.error('❌ ADMIN_PASSWORD 至少需要 12 个字符,请使用更强的密码');
        process.exit(1);
    }

    try {
        const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

        if (existing) {
            console.log(`⚠️  管理员账户已存在,跳过创建:${adminEmail}`);
            console.log('如需重置密码:删除该用户后重新运行本脚本,或通过 SQL 手动更新 passwordHash');
            return;
        }

        const passwordHash = await bcrypt.hash(adminPassword, 12);

        await prisma.user.create({
            data: {
                email: adminEmail,
                passwordHash,
                subscriptionStatus: 'ULTRA',
            },
        });

        console.log('✅ 管理员账户创建成功');
        console.log('────────────────────────────────────────');
        console.log(`Email:    ${adminEmail}`);
        if (passwordWasGenerated) {
            console.log(`Password: ${adminPassword}`);
            console.log('');
            console.log('⚠️  上面这个密码只显示这一次,请立即妥善保存');
            console.log('⚠️  登录后请立刻在用户中心修改为你自己的密码');
        } else {
            console.log('Password: (来自 ADMIN_PASSWORD 环境变量)');
        }
        console.log('────────────────────────────────────────');
        console.log('');
        console.log('💡 别忘了在 .env 里也把这个邮箱加进 ADMIN_EMAILS,管理员才能跳过限流');
    } catch (error) {
        console.error('❌ 创建失败:', error.message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

seedAdmin();
