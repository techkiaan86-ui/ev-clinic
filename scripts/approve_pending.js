import { PrismaClient } from '@prisma/client';
import * as superService from '../src/services/super.service.js';

const prisma = new PrismaClient();

async function main() {
    const pendingReqs = await prisma.registration_request.findMany({
        where: { status: 'PENDING' },
        include: { plan: true }
    });

    for (const reg of pendingReqs) {
        console.log(`Approving registration ID ${reg.id} for ${reg.email}...`);
        
        const clinicName = `${reg.firstName}'s Clinic`;
        const clinicData = {
            name: clinicName,
            location: reg.address || 'Lebanon',
            email: reg.email,
            contact: '0000000000',
            password: reg.password,
            subscriptionDuration: 12,
            subscriptionPlan: reg.plan ? reg.plan.name : 'Free Trial',
            numberOfUsers: 10,
            subscriptionAmount: 0,
            gstPercent: 0
        };

        const clinic = await superService.createClinic(clinicData);

        // Enable all modules for this new clinic
        const updatedModules = {
            pharmacy: true,
            radiology: true,
            laboratory: true,
            billing: true,
            reports: true,
            website_builder: true
        };

        await prisma.clinic.update({
            where: { id: clinic.id },
            data: { modules: JSON.stringify(updatedModules) }
        });

        await prisma.registration_request.update({
            where: { id: reg.id },
            data: { status: 'APPROVED' }
        });

        console.log(`Successfully created clinic and activated account for: ${reg.email}`);
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
