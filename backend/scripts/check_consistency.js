const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDatabaseConsistency() {
    console.log('🔍 数据库一致性检查\n');

    try {
        // 1. 检查订阅状态分布
        console.log('1️⃣ 用户订阅状态分布:');
        const users = await prisma.user.findMany({
            select: {
                email: true,
                subscriptionStatus: true,
                subscriptionEndDate: true
            }
        });

        const statusCount = {};
        users.forEach(u => {
            statusCount[u.subscriptionStatus] = (statusCount[u.subscriptionStatus] || 0) + 1;
        });

        console.table(statusCount);

        // 2. 检查是否有旧的订阅状态
        console.log('\n2️⃣ 检查旧订阅状态:');
        const validStatuses = ['FREE', 'PRO', 'TEAM'];
        const invalidUsers = users.filter(u => !validStatuses.includes(u.subscriptionStatus));

        if (invalidUsers.length > 0) {
            console.log('⚠️  发现旧订阅状态:');
            console.table(invalidUsers);
        } else {
            console.log('✅ 所有用户订阅状态有效');
        }

        // 3. 检查管理员账号
        console.log('\n3️⃣ 管理员账号状态:');
        const admin = await prisma.user.findUnique({
            where: { email: 'admin@docuflow.ai' }
        });

        if (admin) {
            console.log(`✅ 管理员: ${admin.email}`);
            console.log(`   等级: ${admin.subscriptionStatus}`);
            console.log(`   到期: ${admin.subscriptionEndDate || '无限期'}`);
        } else {
            console.log('❌ 未找到管理员账号');
        }

        // 4. 检查最近使用记录
        console.log('\n4️⃣ 最近使用记录 (前5条):');
        const recentLogs = await prisma.usageLog.findMany({
            take: 5,
            orderBy: { createdAt: 'desc' },
            include: {
                user: {
                    select: {
                        email: true,
                        subscriptionStatus: true
                    }
                }
            }
        });

        if (recentLogs.length > 0) {
            console.table(recentLogs.map(log => ({
                时间: log.createdAt.toLocaleString('zh-CN'),
                用户: log.user.email,
                等级: log.user.subscriptionStatus,
                预设: log.presetUsed,
                Token: log.tokenUsage || '-'
            })));
        } else {
            console.log('暂无使用记录');
        }

        // 5. 检查订单中的 planType
        console.log('\n5️⃣ 订单中的套餐类型:');
        const orders = await prisma.order.findMany({
            select: { planType: true },
            distinct: ['planType']
        });

        if (orders.length > 0) {
            console.log('发现的套餐类型:', orders.map(o => o.planType).join(', '));

            // 检查是否有旧的套餐类型
            const validPlans = ['pro_monthly', 'pro_yearly', 'team_monthly', 'team_yearly'];
            const invalidPlans = orders.filter(o => !validPlans.includes(o.planType));

            if (invalidPlans.length > 0) {
                console.log('⚠️  发现旧套餐类型:', invalidPlans.map(o => o.planType).join(', '));
            }
        } else {
            console.log('暂无订单记录');
        }

        console.log('\n✅ 检查完成!');

    } catch (error) {
        console.error('❌ 检查失败:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}

checkDatabaseConsistency();
