/**
 * UsageLog 安全清理脚本(防表无限增长拖慢额度查询)。
 *
 * ⚠️ 命门:actionType='generate_document' 是 FREE 用户终身额度的计数源
 *    (rateLimit.ts / auth.ts 全量 count),**绝不能删**,否则用户额度凭空恢复。
 *
 * 本脚本只删「明确的纯审计日志」白名单中、且超过保留期的记录:
 *   - refund_success        (退款审计,人工对账用,6 个月足够)
 *   - cancel_subscription   (退订审计,同上)
 *
 * 用法:
 *   预演(只统计不删除):  npx tsx scripts/cleanupUsageLogs.ts
 *   真实执行:            CONFIRM=1 npx tsx scripts/cleanupUsageLogs.ts
 *
 * 建议:上线后配置 cron 每月跑一次(先 DRY RUN 看数量,再 CONFIRM)。
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

// 只删白名单内的纯审计类型(显式列出,绝不用 not:'generate_document' 的反向匹配,
// 防止未来新增的计数类 actionType 被误删)
const PURGEABLE_ACTION_TYPES = ['refund_success', 'cancel_subscription'];
const RETENTION_MONTHS = 6;

async function main() {
    const confirm = process.env.CONFIRM === '1';
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);

    const where = {
        actionType: { in: PURGEABLE_ACTION_TYPES },
        createdAt: { lt: cutoff },
    };

    // 统计预演
    const [purgeable, total, generateCount] = await Promise.all([
        prisma.usageLog.count({ where }),
        prisma.usageLog.count(),
        prisma.usageLog.count({ where: { actionType: 'generate_document' } }),
    ]);

    console.log('UsageLog 清理预演');
    console.log('─────────────────────────────────');
    console.log(`总记录数:                ${total}`);
    console.log(`generate_document(保护): ${generateCount}  ← 永不删除`);
    console.log(`可清理(${PURGEABLE_ACTION_TYPES.join('/')},早于 ${cutoff.toISOString().split('T')[0]}): ${purgeable}`);
    console.log('─────────────────────────────────');

    if (!confirm) {
        console.log('DRY RUN — 未删除任何数据。确认无误后执行:');
        console.log('  CONFIRM=1 npx tsx scripts/cleanupUsageLogs.ts');
        return;
    }

    const result = await prisma.usageLog.deleteMany({ where });
    console.log(`✅ 已删除 ${result.count} 条审计日志`);

    // 删除后再次校验计数源未受影响
    const generateAfter = await prisma.usageLog.count({ where: { actionType: 'generate_document' } });
    if (generateAfter !== generateCount) {
        console.error(`❌ 异常:generate_document 计数变化 ${generateCount} → ${generateAfter},请立即检查!`);
        process.exit(1);
    }
    console.log(`✅ 校验通过:generate_document 计数未变(${generateAfter})`);
}

main()
    .catch((e) => { console.error('清理失败:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
