import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const clinics = await prisma.clinic.findMany({
        select: { id: true, name: true, modules: true, status: true, isActive: true }
    });
    console.log('CLINICS:', JSON.stringify(clinics, null, 2));

    const users = await prisma.user.findMany({
        select: { id: true, email: true, role: true, clinicId: true },
        take: 10
    });
    console.log('USERS:', JSON.stringify(users, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
