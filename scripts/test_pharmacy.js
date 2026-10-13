import * as pharmacyService from '../src/services/pharmacy.service.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function test() {
    const clinics = await prisma.clinic.findMany({ select: { id: true, name: true, modules: true } });
    for (const c of clinics) {
        try {
            const data = await pharmacyService.getInventory(c.id);
            console.log(`Clinic ${c.id} (${c.name}) Inventory count:`, data.length);
        } catch (e) {
            console.error(`Clinic ${c.id} ERROR:`, e);
        }
    }
}

test()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
