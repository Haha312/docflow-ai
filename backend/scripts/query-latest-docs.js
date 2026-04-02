const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const docs = await prisma.document.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: { id: true, userId: true, title: true, createdAt: true, wordCount: true }
  });
  console.log(JSON.stringify(docs, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());

