const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function upgradeAdmin() {
    console.log('🚀 Upgrading Admin to TEAM tier...');
    const email = 'admin@docuflow.ai';

    try {
        // 使用原始 SQL 更新，绕过枚举限制
        await prisma.$executeRaw`
            UPDATE "User" 
            SET "subscriptionStatus" = 'TEAM', 
                "subscriptionEndDate" = NOW() + INTERVAL '365 days'
            WHERE email = ${email}
        `;

        const user = await prisma.user.findUnique({ where: { email } });
        if (user) {
            console.log(`✅ Successfully upgraded ${user.email} to TEAM`);
            console.log(`   Subscription ends: ${user.subscriptionEndDate}`);
        } else {
            console.log('❌ User not found');
        }
    } catch (error) {
        console.error(`❌ Error upgrading user:`, error.message);

        // 如果 TEAM 不存在于枚举中，先添加它
        console.log('💡 Trying to add TEAM to enum first...');
        try {
            await prisma.$executeRaw`ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'TEAM'`;
            console.log('✅ Added TEAM to enum, retrying upgrade...');

            await prisma.$executeRaw`
                UPDATE "User" 
                SET "subscriptionStatus" = 'TEAM', 
                    "subscriptionEndDate" = NOW() + INTERVAL '365 days'
                WHERE email = ${email}
            `;
            console.log('✅ Admin upgraded to TEAM successfully!');
        } catch (innerError) {
            console.error('❌ Failed to add TEAM:', innerError.message);
        }
    } finally {
        await prisma.$disconnect();
    }
}

upgradeAdmin();
