/**
 * 一次性数据迁移脚本:SQLite (dev.db) → Supabase PostgreSQL
 *
 * 用法:
 *   1. 确保 backend/.env 的 DATABASE_URL 已指向 Supabase
 *   2. 已经跑过 `npx prisma migrate deploy` 创建好目标表
 *   3. 安装临时依赖:npm install --no-save better-sqlite3 @types/better-sqlite3
 *   4. 执行:npx tsx scripts/migrate-sqlite-to-supabase.ts
 *
 * 可选环境变量:
 *   SQLITE_BACKUP_PATH  指定源 SQLite 文件路径 (默认 ./prisma/dev.db)
 *   RESET_TARGET=1      迁移前先清空目标表 (危险,仅在目标库是新建时使用)
 */
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

let Database: any;
try {
    Database = require('better-sqlite3');
} catch {
    console.error('[ERROR] 缺少 better-sqlite3。请先运行:');
    console.error('  npm install --no-save better-sqlite3 @types/better-sqlite3');
    process.exit(1);
}

const SQLITE_PATH = process.env.SQLITE_BACKUP_PATH || path.join(__dirname, '../prisma/dev.db');
const RESET_TARGET = process.env.RESET_TARGET === '1';

if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`[ERROR] SQLite 源文件不存在: ${SQLITE_PATH}`);
    console.error('用 SQLITE_BACKUP_PATH=... 指定备份文件路径');
    process.exit(1);
}

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith('postgresql://')) {
    console.error('[ERROR] DATABASE_URL 未设置或不是 PostgreSQL 连接串');
    console.error('当前 DATABASE_URL =', process.env.DATABASE_URL);
    process.exit(1);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const prisma = new PrismaClient();

const tableExists = (name: string): boolean => {
    const row = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(name);
    return !!row;
};

const safeDate = (v: any): Date | null => {
    if (v === null || v === undefined) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
};

async function migrate() {
    const dbUrlMasked = process.env.DATABASE_URL!.replace(/:\/\/[^@]+@/, '://***@');
    console.log(`📂 SQLite 源: ${SQLITE_PATH}`);
    console.log(`🐘 Postgres 目标: ${dbUrlMasked}`);
    console.log(`🧹 清空目标表: ${RESET_TARGET ? 'YES' : 'no (跳过冲突会报错)'}`);
    console.log('');

    if (RESET_TARGET) {
        console.log('[reset] 按依赖反序清空目标表...');
        await prisma.systemConfig.deleteMany();
        await prisma.document.deleteMany();
        await prisma.order.deleteMany();
        await prisma.usageLog.deleteMany();
        await prisma.user.deleteMany();
        console.log('  ✅ 已清空\n');
    }

    // 1. User (无外键)
    if (tableExists('User')) {
        const users = sqlite.prepare('SELECT * FROM User').all() as any[];
        console.log(`[1/5] User: ${users.length} 条`);
        for (const u of users) {
            await prisma.user.create({
                data: {
                    id: u.id,
                    email: u.email,
                    passwordHash: u.passwordHash,
                    subscriptionStatus: u.subscriptionStatus,
                    subscriptionEndDate: safeDate(u.subscriptionEndDate),
                    createdAt: safeDate(u.createdAt) || new Date(),
                    updatedAt: safeDate(u.updatedAt) || new Date(),
                },
            });
        }
        console.log(`  ✅ User done`);
    }

    // 2. UsageLog (FK → User)
    if (tableExists('UsageLog')) {
        const logs = sqlite.prepare('SELECT * FROM UsageLog').all() as any[];
        console.log(`[2/5] UsageLog: ${logs.length} 条`);
        for (const l of logs) {
            await prisma.usageLog.create({
                data: {
                    id: l.id,
                    userId: l.userId,
                    actionType: l.actionType,
                    presetUsed: l.presetUsed,
                    tokenUsage: l.tokenUsage ?? null,
                    createdAt: safeDate(l.createdAt) || new Date(),
                },
            });
        }
        console.log(`  ✅ UsageLog done`);
    }

    // 3. Order (FK → User)
    if (tableExists('Order')) {
        const orders = sqlite.prepare('SELECT * FROM "Order"').all() as any[];
        console.log(`[3/5] Order: ${orders.length} 条`);
        for (const o of orders) {
            await prisma.order.create({
                data: {
                    id: o.id,
                    userId: o.userId,
                    amount: String(o.amount),
                    currency: o.currency,
                    planType: o.planType,
                    status: o.status,
                    createdAt: safeDate(o.createdAt) || new Date(),
                    updatedAt: safeDate(o.updatedAt) || new Date(),
                },
            });
        }
        console.log(`  ✅ Order done`);
    }

    // 4. Document (FK → User)
    if (tableExists('Document')) {
        const docs = sqlite.prepare('SELECT * FROM Document').all() as any[];
        console.log(`[4/5] Document: ${docs.length} 条`);
        for (const d of docs) {
            await prisma.document.create({
                data: {
                    id: d.id,
                    userId: d.userId,
                    title: d.title,
                    content: d.content,
                    wordCount: d.wordCount ?? null,
                    preset: d.preset,
                    createdAt: safeDate(d.createdAt) || new Date(),
                },
            });
        }
        console.log(`  ✅ Document done`);
    } else {
        console.log('[4/5] Document: 表不存在,跳过');
    }

    // 5. SystemConfig
    if (tableExists('SystemConfig')) {
        const configs = sqlite.prepare('SELECT * FROM SystemConfig').all() as any[];
        console.log(`[5/5] SystemConfig: ${configs.length} 条`);
        for (const c of configs) {
            await prisma.systemConfig.create({
                data: {
                    key: c.key,
                    value: c.value,
                    updatedAt: safeDate(c.updatedAt) || new Date(),
                },
            });
        }
        console.log(`  ✅ SystemConfig done`);
    } else {
        console.log('[5/5] SystemConfig: 表不存在,跳过');
    }

    // 验证
    console.log('\n📊 目标库记录数验证:');
    const [u, l, o, d, c] = await Promise.all([
        prisma.user.count(),
        prisma.usageLog.count(),
        prisma.order.count(),
        prisma.document.count(),
        prisma.systemConfig.count(),
    ]);
    console.log(`  User=${u}  UsageLog=${l}  Order=${o}  Document=${d}  SystemConfig=${c}`);
}

migrate()
    .then(() => {
        console.log('\n✅ 迁移完成');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ 迁移失败:', err);
        console.error('\n💡 提示:如目标表已有数据,试试 RESET_TARGET=1 npx tsx scripts/migrate-sqlite-to-supabase.ts');
        process.exit(1);
    })
    .finally(async () => {
        try { sqlite.close(); } catch {}
        await prisma.$disconnect();
    });
