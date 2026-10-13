import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const clinic = await prisma.clinic.findUnique({
        where: { id: 10 }
    });
    console.log('HUSRI CLINIC IN DB:', JSON.stringify(clinic, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
