import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const clinics = await prisma.clinic.findMany();
    for (const clinic of clinics) {
        let currentModules = {};
        try {
            currentModules = clinic.modules ? JSON.parse(clinic.modules) : {};
        } catch (e) {
            currentModules = {};
        }

        const updatedModules = {
            ...currentModules,
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
        console.log(`Updated clinic ${clinic.id} (${clinic.name}):`, updatedModules);
    }
    console.log('Successfully enabled all modules across all clinics!');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
