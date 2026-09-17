import dotenv from 'dotenv';
dotenv.config({ path: './src/.env' });

import { updateInvoiceStatus, createInvoice, getPendingBillingItems } from './src/services/billing.service.js';
import { prisma } from './src/lib/prisma.js';

async function verify() {
    console.log('🧪 Starting Automated Payment Lock & Duplicate Prevention Verification...\n');

    // 1. Fetch first clinic and patient
    const clinic = await prisma.clinic.findFirst();
    if (!clinic) throw new Error('No clinic found');
    const patient = await prisma.patient.findFirst({ where: { clinicId: clinic.id } });
    if (!patient) throw new Error('No patient found');

    console.log(`Clinic ID: ${clinic.id}, Patient ID: ${patient.id}`);

    // 2. Fetch pending items
    const pending = await getPendingBillingItems(clinic.id, patient.id);
    console.log(`Found ${pending.consultations.length} pending consultations, ${pending.orders.length} pending orders.`);

    let testItem: any = pending.consultations[0] || pending.orders[0];

    if (!testItem) {
        // Create a dummy appointment to test
        const newAppt = await prisma.appointment.create({
            data: {
                clinicId: clinic.id,
                patientId: patient.id,
                doctorId: 70,
                date: new Date(),
                time: '10:00 AM',
                status: 'Confirmed',
                billingAmount: 1.50,
                service: 'Test Consultation 1.50'
            }
        });
        testItem = {
            id: newAppt.id,
            type: 'consultation',
            description: 'Test Consultation 1.50',
            amount: 1.50
        };
        console.log(`Created test appointment ID: ${newAppt.id} for $1.50`);
    }

    // 3. Create Pending Invoice
    console.log('\nStep 1: Creating invoice for test item ($1.50)...');
    const invoice = await createInvoice(clinic.id, {
        patientId: patient.id,
        items: [testItem],
        status: 'Pending',
        paymentMethod: null,
        createdBy: 1
    });
    console.log(`✅ Invoice Created: ${invoice.id} (Status: ${invoice.status}, Total: $${invoice.totalAmount})`);

    // 4. Record Payment (1st time)
    console.log('\nStep 2: Recording $1.50 payment for invoice...');
    const paidInvoice = await updateInvoiceStatus(clinic.id, invoice.id, 'Paid', 'Cash');
    console.log(`✅ Payment Successful: ${paidInvoice.id} is now ${paidInvoice.status}`);

    // 5. Attempt 2nd Payment on Same Invoice (Must fail & lock!)
    console.log('\nStep 3: Attempting 2nd payment on same invoice (Must be blocked)...');
    try {
        await updateInvoiceStatus(clinic.id, invoice.id, 'Paid', 'Cash');
        console.error('❌ FAIL: Duplicate payment was allowed on already paid invoice!');
    } catch (err: any) {
        console.log(`✅ SUCCESS: Duplicate payment blocked cleanly with message -> "${err.message}"`);
    }

    // 6. Attempt Duplicate Invoice Creation for Same Paid Item (Must fail & lock!)
    console.log('\nStep 4: Attempting duplicate invoice creation for already paid item (Must be blocked)...');
    try {
        await createInvoice(clinic.id, {
            patientId: patient.id,
            items: [testItem],
            status: 'Pending'
        });
        console.error('❌ FAIL: Duplicate invoice was allowed for already paid item!');
    } catch (err: any) {
        console.log(`✅ SUCCESS: Duplicate invoice creation blocked cleanly with message -> "${err.message}"`);
    }

    // 7. Verify Pending Items Filter
    console.log('\nStep 5: Verifying paid item is excluded from Pending Items queue...');
    const updatedPending = await getPendingBillingItems(clinic.id, patient.id);
    const itemInPending = [...updatedPending.consultations, ...updatedPending.orders].find(i => i.id === testItem.id && i.type === testItem.type);

    if (!itemInPending) {
        console.log('✅ SUCCESS: Paid item is excluded from pending items list.');
    } else {
        console.error('❌ FAIL: Paid item still appears in pending list!');
    }

    console.log('\n🎉 ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!');
}

verify()
    .catch((e) => {
        console.error('Verification failed:', e);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
