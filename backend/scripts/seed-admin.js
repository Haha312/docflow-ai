const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function seedAdmin() {
    const prisma = new PrismaClient();

    const adminEmail = 'admin@docuflow.ai';
    const adminPassword = 'Admin@123456';

    try {
        // 检查管理员是否已存在
        const existing = await prisma.user.findUnique({
            where: { email: adminEmail }
        });

        if (existing) {
            console.log('管理员账户已存在，跳过创建');
            console.log('Email: ' + adminEmail);
            return;
        }

        // 加密密码
        const passwordHash = await bcrypt.hash(adminPassword, 10);

        // 创建管理员账户
        const admin = await prisma.user.create({
            data: {
                email: adminEmail,
                passwordHash: passwordHash,
                subscriptionStatus: 'ULTRA'  // 给管理员最高权限
            }
        });

        console.log('✅ 管理员账户创建成功！');
        console.log('---');
        console.log('Email: ' + adminEmail);
        console.log('Password: ' + adminPassword);
        console.log('Status: ULTRA');
        console.log('---');

    } catch (error) {
        console.error('创建失败: ' + error.message);
    } finally {
        await prisma.$disconnect();
    }
}

seedAdmin();
