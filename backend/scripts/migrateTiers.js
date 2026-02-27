const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Update TEAM to something valid for now or use raw SQL to avoid strictly typed enum mismatch if Prisma schema changed
    // Wait, the prisma schema is already changed in the file, so Prisma Client might complain. Let's use raw SQL.
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "subscriptionStatus" = 'ULTRA' WHERE "subscriptionStatus" = 'TEAM'`);
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "subscriptionStatus" = 'PRO' WHERE "subscriptionStatus" = 'PRO_PLUS'`);
    console.log('Migration complete');
}

main().catch(console.error).finally(() => prisma.$disconnect());
