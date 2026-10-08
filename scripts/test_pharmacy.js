import * as pharmacyService from '../src/services/pharmacy.service.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function test() {
    const clinics = await prisma.clinic.findMany();
    for (const c of clinics) {
        const inventory = await pharmacyService.getInventory(c.id, {});
        console.log(`Clinic ${c.id} (${c.name}) Inventory count:`, inventory?.data?.length ?? inventory?.length ?? 0);
    }
}

test()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
