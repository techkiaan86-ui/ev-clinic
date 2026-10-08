import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany({
        where: {
            role: { in: ['LAB', 'RADIOLOGY', 'PHARMACY', 'DOCTOR', 'ADMIN', 'ACCOUNTANT', 'DOCUMENT_CONTROLLER'] }
        },
        select: { id: true, name: true, email: true, role: true, status: true },
        orderBy: { id: 'asc' }
    });
    console.log('ALL DEPARTMENT USERS IN DB:');
    users.forEach(u => console.log(`- Role: [${u.role.padEnd(12)}] | Name: ${u.name.padEnd(24)} | Email: ${u.email}`));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
