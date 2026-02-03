
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const email = 'hanhaha312@gmail.com';
    console.log(`Searching for user: ${email}...`);

    const user = await prisma.user.findUnique({
        where: { email },
    });

    if (!user) {
        console.log('User not found.');
        return;
    }

    console.log(`Deleting user ID: ${user.id}...`);
    await prisma.user.delete({
        where: { id: user.id },
    });

    console.log('User deleted successfully.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
