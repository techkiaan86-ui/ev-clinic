import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedPlans() {
    console.log('Seeding published plans and free trial...');

    // Clear existing or check count
    const existing = await prisma.subscription_plan.findMany();
    if (existing.length > 0) {
        console.log(`Found ${existing.length} existing plans. Updating/Verifying active status...`);
        for (const p of existing) {
            await prisma.subscription_plan.update({
                where: { id: p.id },
                data: { isActive: true }
            });
        }
    } else {
        // 1. Free Trial Plan (100 Free Credits, Pay-as-you-go, Never Expire)
        await prisma.subscription_plan.create({
            data: {
                name: 'Free Trial (100 Free Credits)',
                price: 0.00,
                duration: 'Free Trial',
                isActive: true,
                features: JSON.stringify([
                    '100 Free Credits included immediately',
                    'Pay-as-you-go credits system',
                    'Credits never expire (Lifetime validity)',
                    'Full access to Doctor EHR & Clinical Records',
                    'Interactive Dental Tooth Chart & Assessment',
                    'Centralized Invoicing (USD & LBP dual currency)',
                    'Patient portal access & booking',
                    'No credit card required to start'
                ])
            }
        });

        // 2. Professional Clinic Plan
        await prisma.subscription_plan.create({
            data: {
                name: 'Professional Clinic',
                price: 49.00,
                duration: 'Monthly',
                isActive: true,
                features: JSON.stringify([
                    '1,000 Included Monthly Credits',
                    'Additional Pay-as-you-go credits (Never Expire)',
                    'Unlimited Patient Records & Appointments',
                    'Interactive Dental, Orthopedic & General Assessment',
                    'Pharmacy Inventory & Batch Expiry Tracking',
                    'Radiology & Laboratory Workflow Management',
                    'CNSS & Private Insurance Claims Management',
                    'USD & LBP Dual Currency Invoicing & Accounting',
                    'Multi-language Support (English, Arabic, French)',
                    'Priority Email & Chat Support'
                ])
            }
        });

        // 3. Enterprise / Multi-Clinic Plan
        await prisma.subscription_plan.create({
            data: {
                name: 'Enterprise Multi-Specialty',
                price: 149.00,
                duration: 'Monthly',
                isActive: true,
                features: JSON.stringify([
                    '5,000 Included Monthly Credits',
                    'Pay-as-you-go top-ups at lowest volume rates',
                    'Credits never expire across all branches',
                    'Unlimited Doctors, Nurses & Staff Logins',
                    'Multi-branch Clinic Management',
                    'Custom Assessment & Clinical Document Templates',
                    'Full Accounting, Invoicing & Financial Analytics',
                    'Automated Stock Alerts & Purchase Orders',
                    'Role-based Access & Audit Logs',
                    'Dedicated Account Manager & 24/7 Phone Support'
                ])
            }
        });

        console.log('Successfully seeded 3 published subscription plans.');
    }

    const all = await prisma.subscription_plan.findMany();
    console.log('Active published plans in DB:', all);
}

seedPlans()
    .catch((e) => {
        console.error('Error seeding plans:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
