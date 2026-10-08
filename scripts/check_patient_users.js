import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const patients = await prisma.user.findMany({
        where: { role: 'PATIENT' },
        select: { id: true, name: true, email: true, role: true, status: true },
        take: 5
    });
    console.log('PATIENT LOGINS IN DB:', JSON.stringify(patients, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
