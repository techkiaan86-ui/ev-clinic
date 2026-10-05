import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const doctorTemplates = [
    {
        name: 'General Doctor Template',
        specialty: 'General Practice',
        fields: [
            { id: 'chief_complaint', type: 'textarea', label: 'Chief Complaint', required: true, placeholder: "Describe patient's primary symptoms, complaints, and duration..." },
            { id: 'history_present_illness', type: 'textarea', label: 'History of Present Illness (HPI)', required: false, placeholder: 'Onset, location, duration, character, aggravating and relieving factors...' },
            { id: 'past_medical_history', type: 'textarea', label: 'Past Medical & Surgical History', required: false, placeholder: 'Chronic conditions, past surgeries, allergies, ongoing medications...' },
            { id: 'physical_examination', type: 'textarea', label: 'Physical & Systemic Examination', required: false, placeholder: 'General appearance, systemic findings (Cardiovascular, Respiratory, Abdominal, CNS)...' }
        ]
    },
    {
        name: 'Dental Doctor Template',
        specialty: 'Dentistry',
        fields: [
            { id: 'dental_complaint', type: 'textarea', label: 'Chief Dental Complaint', required: true, placeholder: 'Toothache, gum bleeding, sensitivity, dental trauma, swelling, broken restoration...' },
            { id: 'teeth_involved', type: 'text', label: 'Tooth / Teeth Number(s) Involved', required: false, placeholder: 'e.g. Tooth #18, Upper Right Quadrant, Lower Anterior...' },
            { id: 'intraoral_findings', type: 'textarea', label: 'Intraoral & Periodontal Examination', required: false, placeholder: 'Caries detection, gingivitis, periodontal pocket depth, tooth mobility, oral mucosa...' },
            { id: 'dental_procedure_indicated', type: 'dropdown', label: 'Dental Procedure Indicated', required: false, options: ['Dental Cleaning / Scaling', 'Composite Filling / Restoration', 'Root Canal Treatment (RCT)', 'Tooth Extraction', 'Crown / Bridge Placement', 'Orthodontic Evaluation', 'Dental Implant', 'Other Procedure'] },
            { id: 'oral_hygiene_instructions', type: 'textarea', label: 'Oral Hygiene & Post-Treatment Instructions', required: false, placeholder: 'Brushing technique, flossing, mouth rinse, dietary recommendations...' }
        ]
    },
    {
        name: 'Orthopedic Doctor Template',
        specialty: 'Orthopedics',
        fields: [
            { id: 'ortho_complaint', type: 'textarea', label: 'Chief Orthopedic Complaint & Affected Region', required: true, placeholder: 'Joint pain, stiffness, fracture, sports injury, swelling, trauma history...' },
            { id: 'pain_scale', type: 'dropdown', label: 'Pain Severity Scale (1 - 10)', required: false, options: ['1 - Minimal', '2 - Mild', '3 - Mild', '4 - Moderate', '5 - Moderate', '6 - Moderately Severe', '7 - Severe', '8 - Very Severe', '9 - Extremely Severe', '10 - Maximum Pain'] },
            { id: 'range_of_motion', type: 'textarea', label: 'Range of Motion & Joint Examination', required: false, placeholder: 'Active/passive ROM, joint stability, deformity, swelling, local temperature, tenderness...' },
            { id: 'neurovascular_status', type: 'textarea', label: 'Neurovascular & Motor Assessment', required: false, placeholder: 'Peripheral pulses, motor power, sensory examination, deep tendon reflexes...' },
            { id: 'imaging_findings', type: 'textarea', label: 'X-Ray / MRI / Imaging Findings', required: false, placeholder: 'Fracture line, bone alignment, joint space narrowing, soft tissue/ligament tear...' }
        ]
    }
];

async function main() {
    console.log('Seeding / Upserting Doctor Templates...');

    for (const t of doctorTemplates) {
        const existing = await prisma.formtemplate.findFirst({
            where: {
                name: t.name,
                clinicId: null
            }
        });

        if (existing) {
            await prisma.formtemplate.update({
                where: { id: existing.id },
                data: {
                    specialty: t.specialty,
                    status: 'published',
                    fields: JSON.stringify(t.fields)
                }
            });
            console.log(`Updated template: ${t.name} (ID: ${existing.id})`);
        } else {
            const created = await prisma.formtemplate.create({
                data: {
                    clinicId: null,
                    name: t.name,
                    specialty: t.specialty,
                    status: 'published',
                    version: 1,
                    fields: JSON.stringify(t.fields)
                }
            });
            console.log(`Created template: ${t.name} (ID: ${created.id})`);
        }
    }

    console.log('All Doctor Templates successfully seeded.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
