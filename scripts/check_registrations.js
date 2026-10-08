import { PrismaClient } from '@prisma/client';
import * as superService from '../src/services/super.service.js';

const prisma = new PrismaClient();

async function main() {
    const requests = await prisma.registration_request.findMany({
        include: { plan: true },
        orderBy: { id: 'desc' }
    });
    console.log('REGISTRATIONS:', JSON.stringify(requests, null, 2));

    const users = await prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, status: true },
        orderBy: { id: 'desc' },
        take: 10
    });
    console.log('LATEST USERS IN DB:', JSON.stringify(users, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
