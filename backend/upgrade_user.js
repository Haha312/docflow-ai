const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function upgradeUser() {
    console.log('🚀 Upgrading User to PRO...');
    const email = 'user1@docuflow.ai'; // Target user

    try {
        const user = await prisma.user.update({
            where: { email: email },
            data: {
                subscriptionStatus: 'PRO',
                subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
            }
        });
        console.log(`✅ Successfully upgraded ${user.email} to ${user.subscriptionStatus}`);
    } catch (error) {
        console.error(`❌ Error upgrading user:`, error.message);
    } finally {
        await prisma.$disconnect();
    }
}

upgradeUser();
