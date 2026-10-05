import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const standardMedicines = [
    // Antibiotics
    { name: 'Amoxicillin + Clavulanic Acid 625mg (Augmentin)', sku: 'MED-AUG-625', unitPrice: 15.00, quantity: 500 },
    { name: 'Azithromycin 500mg (Azee / Zithromax)', sku: 'MED-AZI-500', unitPrice: 12.00, quantity: 500 },
    { name: 'Ciprofloxacin 500mg (Cipro / Ciplox)', sku: 'MED-CIP-500', unitPrice: 10.00, quantity: 500 },
    { name: 'Cefixime 200mg (Zifi / Suprax)', sku: 'MED-CEF-200', unitPrice: 14.00, quantity: 500 },
    { name: 'Doxycycline 100mg (Doxicip)', sku: 'MED-DOX-100', unitPrice: 8.00, quantity: 500 },
    { name: 'Metronidazole 400mg (Flagyl)', sku: 'MED-MET-400', unitPrice: 6.00, quantity: 500 },
    { name: 'Clindamycin 300mg (Dalacin-C)', sku: 'MED-CLI-300', unitPrice: 18.00, quantity: 500 },

    // Pain Relief & NSAIDs
    { name: 'Paracetamol / Acetaminophen 650mg (Dolo / Calpol)', sku: 'MED-PCM-650', unitPrice: 3.00, quantity: 1000 },
    { name: 'Ibuprofen 400mg (Brufen)', sku: 'MED-IBU-400', unitPrice: 5.00, quantity: 500 },
    { name: 'Diclofenac Sodium 50mg (Voveran)', sku: 'MED-DIC-50', unitPrice: 6.00, quantity: 500 },
    { name: 'Aceclofenac + Paracetamol (Zerodol-P)', sku: 'MED-ACE-P', unitPrice: 8.00, quantity: 500 },
    { name: 'Tramadol 50mg (Ultram)', sku: 'MED-TRA-50', unitPrice: 15.00, quantity: 300 },
    { name: 'Ketorolac Tromethamine 10mg (Ketanov DT)', sku: 'MED-KET-10', unitPrice: 9.00, quantity: 500 },

    // Gastrointestinal & Antacids
    { name: 'Pantoprazole 40mg (Pantocid / Pan-40)', sku: 'MED-PAN-40', unitPrice: 9.00, quantity: 800 },
    { name: 'Omeprazole 20mg (Omez)', sku: 'MED-OME-20', unitPrice: 7.00, quantity: 600 },
    { name: 'Rabeprazole 20mg + Domperidone (Razo-D)', sku: 'MED-RAB-D', unitPrice: 12.00, quantity: 500 },
    { name: 'Ondansetron 4mg (Emeset / Zofran)', sku: 'MED-OND-4', unitPrice: 6.00, quantity: 500 },
    { name: 'Antacid Gel Suspension 200ml (Gelusil / Digene)', sku: 'MED-ANT-GEL', unitPrice: 20.00, quantity: 200 },

    // Antiallergic & Respiratory
    { name: 'Cetirizine 10mg (Zyrtec / Cetzine)', sku: 'MED-CET-10', unitPrice: 4.00, quantity: 800 },
    { name: 'Levocetirizine 5mg + Montelukast 10mg (Montair-LC)', sku: 'MED-LEV-MON', unitPrice: 14.00, quantity: 500 },
    { name: 'Salbutamol Inhaler 100mcg (Asthalin)', sku: 'MED-SAL-INH', unitPrice: 25.00, quantity: 150 },
    { name: 'Dextromethorphan + Chlorpheniramine Syrup 100ml', sku: 'MED-COUGH-SYR', unitPrice: 18.00, quantity: 200 },

    // Dental Specialty
    { name: 'Chlorhexidine Gluconate 0.2% Mouthwash 150ml (Hexidine)', sku: 'MED-CHX-MW', unitPrice: 22.00, quantity: 300 },
    { name: 'Triamcinolone Acetonide 0.1% Oral Paste (Kenacort Oral)', sku: 'MED-KEN-ORAL', unitPrice: 19.00, quantity: 200 },
    { name: 'Benzocaine 20% Oral Topical Gel', sku: 'MED-BENZ-GEL', unitPrice: 15.00, quantity: 200 },

    // Orthopedic Specialty & Muscle Relaxants
    { name: 'Aceclofenac + Thiocolchicoside (Zerodol-TH)', sku: 'MED-ACE-TH', unitPrice: 22.00, quantity: 400 },
    { name: 'Calcium Carbonate 500mg + Vitamin D3 250 IU (Shelcal 500)', sku: 'MED-CAL-D3', unitPrice: 8.00, quantity: 600 },
    { name: 'Glucosamine Sulfate 750mg + Chondroitin', sku: 'MED-GLU-CHON', unitPrice: 25.00, quantity: 300 },
    { name: 'Methylcobalamin (B12) 1500mcg (Nurokind / Neurobion)', sku: 'MED-ME-B12', unitPrice: 11.00, quantity: 500 },

    // Vitamins & Nutritional
    { name: 'Vitamin D3 60,000 IU Capsules (Calcirol / D-Rise)', sku: 'MED-VIT-D3', unitPrice: 18.00, quantity: 500 },
    { name: 'Multivitamin & Mineral Complex Capsules (Becadexamin)', sku: 'MED-MULTI-VIT', unitPrice: 6.00, quantity: 800 },
    { name: 'Iron + Folic Acid Tablets (Ferrous Ascorbate / Orofer-XT)', sku: 'MED-FE-FOLIC', unitPrice: 12.00, quantity: 500 },
    { name: 'Magnesium Glycinate / Citrate 400mg Tablets', sku: 'MED-MAG-400', unitPrice: 16.00, quantity: 400 },

    // Cardiovascular & Diabetes
    { name: 'Amlodipine 5mg (Norvasc / Amlong)', sku: 'MED-AML-5', unitPrice: 5.00, quantity: 500 },
    { name: 'Telmisartan 40mg (Telma / Micardis)', sku: 'MED-TEL-40', unitPrice: 10.00, quantity: 500 },
    { name: 'Atorvastatin 10mg (Lipitor / Atorva)', sku: 'MED-ATO-10', unitPrice: 12.00, quantity: 500 },
    { name: 'Aspirin 75mg Gastro-Resistant (Ecosprin)', sku: 'MED-ASP-75', unitPrice: 3.00, quantity: 800 },
    { name: 'Metformin 500mg Sustained Release (Glycomet-SR)', sku: 'MED-MET-500', unitPrice: 5.00, quantity: 600 }
];

async function main() {
    console.log('Seeding Pharmacy Medicines into Inventory...');
    const clinics = await prisma.clinic.findMany();

    for (const clinic of clinics) {
        console.log(`Processing Clinic: ${clinic.name} (ID: ${clinic.id})`);
        for (const med of standardMedicines) {
            const existing = await prisma.inventory.findFirst({
                where: {
                    clinicId: clinic.id,
                    name: med.name
                }
            });

            if (!existing) {
                await prisma.inventory.create({
                    data: {
                        clinicId: clinic.id,
                        name: med.name,
                        sku: med.sku,
                        quantity: med.quantity,
                        unitPrice: med.unitPrice,
                        expiryDate: new Date('2028-12-31')
                    }
                });
            } else {
                await prisma.inventory.update({
                    where: { id: existing.id },
                    data: {
                        quantity: Math.max(existing.quantity, med.quantity),
                        unitPrice: med.unitPrice
                    }
                });
            }
        }
    }

    console.log('Pharmacy Medicines successfully seeded into all clinics.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
