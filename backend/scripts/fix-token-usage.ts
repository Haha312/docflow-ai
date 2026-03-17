/**
 * 一次性脚本：修正历史 tokenUsage 数据
 * 
 * 旧公式：ceil(chars / 0.75) 严重高估了 token 用量
 * 实际上 Gemini 对中文的 tokenization 大约是 1 token ≈ 1.5~2 个中文字符
 * 加上输出 HTML 标签也被当作中文字符算了，导致总估值偏高约 70+ 倍
 * 
 * 使用方式:
 *   npx ts-node scripts/fix-token-usage.ts
 * 
 * 会自动计算修正系数，将所有历史记录按比例缩小
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 代理端实际统计数据（用户截图提供）
const PROXY_ACTUAL_TOTAL_TOKENS = 1_457_670;  // 代理显示的真实 token 消耗
const PROXY_TOTAL_CALLS = 21;                  // 代理显示的调用次数

async function main() {
    console.log('📊 开始修正历史 Token 使用数据...\n');

    // 1. 获取数据库当前统计
    const dbStats = await prisma.usageLog.aggregate({
        _sum: { tokenUsage: true },
        _count: { id: true }
    });

    const dbTotalTokens = dbStats._sum.tokenUsage || 0;
    const dbTotalCalls = dbStats._count.id || 0;

    console.log(`📋 数据库现状:`);
    console.log(`   总记录数: ${dbTotalCalls}`);
    console.log(`   总 Token 数: ${dbTotalTokens.toLocaleString()}`);
    console.log(`   平均每次: ${dbTotalCalls > 0 ? Math.round(dbTotalTokens / dbTotalCalls).toLocaleString() : 0}`);
    console.log();

    console.log(`📋 代理端实际数据:`);
    console.log(`   总调用次数: ${PROXY_TOTAL_CALLS}`);
    console.log(`   总 Token 数: ${PROXY_ACTUAL_TOTAL_TOKENS.toLocaleString()}`);
    console.log(`   平均每次: ${Math.round(PROXY_ACTUAL_TOTAL_TOKENS / PROXY_TOTAL_CALLS).toLocaleString()}`);
    console.log();

    if (dbTotalTokens === 0) {
        console.log('✅ 数据库中没有 token 记录，无需修正。');
        return;
    }

    // 2. 计算修正系数
    // 用代理的平均值来修正所有历史记录
    const avgRealTokensPerCall = PROXY_ACTUAL_TOTAL_TOKENS / PROXY_TOTAL_CALLS;
    const avgDbTokensPerCall = dbTotalTokens / dbTotalCalls;
    const correctionFactor = avgRealTokensPerCall / avgDbTokensPerCall;

    console.log(`🔧 修正系数: ${correctionFactor.toFixed(4)} (即旧值 × ${correctionFactor.toFixed(4)})`);
    console.log(`   旧平均: ${Math.round(avgDbTokensPerCall).toLocaleString()} → 新平均: ${Math.round(avgRealTokensPerCall).toLocaleString()}`);
    console.log(`   预计修正后总量: ${Math.round(dbTotalTokens * correctionFactor).toLocaleString()}`);
    console.log();

    // 3. 批量更新所有记录
    console.log('⏳ 正在更新所有历史记录...');

    const allLogs = await prisma.usageLog.findMany({
        select: { id: true, tokenUsage: true }
    });

    let updated = 0;
    for (const log of allLogs) {
        if (log.tokenUsage && log.tokenUsage > 0) {
            const newTokenUsage = Math.round(log.tokenUsage * correctionFactor);
            await prisma.usageLog.update({
                where: { id: log.id },
                data: { tokenUsage: newTokenUsage }
            });
            updated++;
        }
    }

    // 4. 验证结果
    const newStats = await prisma.usageLog.aggregate({
        _sum: { tokenUsage: true },
        _count: { id: true }
    });

    console.log(`\n✅ 修正完成！共更新 ${updated} 条记录`);
    console.log(`📊 修正后统计:`);
    console.log(`   总 Token 数: ${(newStats._sum.tokenUsage || 0).toLocaleString()}`);
    console.log(`   平均每次: ${newStats._count.id ? Math.round((newStats._sum.tokenUsage || 0) / newStats._count.id).toLocaleString() : 0}`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
