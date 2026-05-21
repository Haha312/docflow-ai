import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
    console.error('[FATAL] DATABASE_URL is not set. Configure it in .env (see .env.example).');
    process.exit(1);
}

const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

prisma
    .$connect()
    .then(() => {
        console.log('[db] Connected to PostgreSQL');
    })
    .catch((err: Error) => {
        console.error('[db] Failed to connect to PostgreSQL:', err.message);
        console.error(
            '[db] If using Supabase: verify DATABASE_URL host/password, ensure your server IP is allowed under Project Settings → Database → Network Restrictions, and that the project is not paused.'
        );
        process.exit(1);
    });

process.on('beforeExit', async () => {
    await prisma.$disconnect();
});

export default prisma;
