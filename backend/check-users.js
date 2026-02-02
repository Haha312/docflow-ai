const { PrismaClient } = require('@prisma/client');

async function checkUsers() {
    const prisma = new PrismaClient();
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                email: true,
                passwordHash: true,
                subscriptionStatus: true,
                createdAt: true
            }
        });
        console.log('=== Users in database ===');
        console.log('Total users: ' + users.length);
        users.forEach((user, i) => {
            console.log('---');
            console.log('User ' + (i + 1) + ':');
            console.log('Email: ' + user.email);
            console.log('Hash: ' + user.passwordHash.substring(0, 30) + '...');
            console.log('Status: ' + user.subscriptionStatus);
        });
    } catch (error) {
        console.error('Error: ' + error.message);
    } finally {
        await prisma.$disconnect();
    }
}

checkUsers();
