const jwt = require('../backend/node_modules/jsonwebtoken');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

async function main() {
  const phone = process.argv[2] || process.env.ADMIN_PHONE || '18811633126';
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET is not set');

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.upsert({
      where: { phone },
      update: { subscriptionStatus: 'ULTRA', subscriptionEndDate: null },
      create: { phone, subscriptionStatus: 'ULTRA' },
      select: { id: true, phone: true, tokenVersion: true, subscriptionStatus: true },
    });
    const token = jwt.sign(
      { userId: user.id, phone: user.phone, tokenVersion: user.tokenVersion },
      jwtSecret,
      { expiresIn: '24h', algorithm: 'HS256' }
    );
    console.log(JSON.stringify({ user, token }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
