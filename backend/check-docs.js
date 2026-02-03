const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const docs = await prisma.document.findMany({
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: {
            id: true,
            title: true,
            wordCount: true,
            content: true,
            createdAt: true
        }
    });

    docs.forEach((doc, i) => {
        console.log(`\n--- Document ${i + 1} ---`);
        console.log(`ID: ${doc.id}`);
        console.log(`Title: ${doc.title}`);
        console.log(`Word Count (stored): ${doc.wordCount}`);
        console.log(`Actual Content Length: ${doc.content?.length || 0} chars`);
        console.log(`Created: ${doc.createdAt}`);
    });
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
