import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';

export const getDoctorQueue = async (clinicId: number, doctorId: number) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    return await prisma.appointment.findMany({
        where: {
            clinicId,
            doctorId,
            status: { notIn: ['Cancelled', 'cancelled', 'Rejected'] },
            date: {
                gte: today,
                lte: endOfDay
            }
        },
        include: { patient: true },
        orderBy: { time: 'asc' }
    });
};

export const resolveServicePrice = async (txOrPrisma: any, clinicId: number, type: string, testName: string, providedAmount?: any): Promise<number> => {
    if (providedAmount !== undefined && providedAmount !== null && !isNaN(Number(providedAmount)) && Number(providedAmount) > 0) {
        return Number(providedAmount);
    }
    // 1. Look up in clinic_service table
    try {
        const cs = await txOrPrisma.clinic_service.findFirst({
            where: {
                clinicId,
                type: type.toUpperCase(),
                name: { equals: testName }
            }
        });
        if (cs && cs.price && Number(cs.price) > 0) {
            return Number(cs.price);
        }
    } catch (e) {
        console.error('Error looking up clinic_service price:', e);
    }

    // 2. Standard baseline tariff fallbacks for popular tests
    const normalized = (testName || '').toLowerCase();
    if (type.toUpperCase() === 'LAB') {
        if (normalized.includes('cbc') || normalized.includes('hemogram')) return 25;
        if (normalized.includes('hb') || normalized.includes('hemoglobin')) return 15;
        if (normalized.includes('esr')) return 10;
        if (normalized.includes('sugar') || normalized.includes('glucose') || normalized.includes('fbs') || normalized.includes('rbs') || normalized.includes('ppbs')) return 12;
        if (normalized.includes('hba1c')) return 30;
        if (normalized.includes('lft') || normalized.includes('liver')) return 40;
        if (normalized.includes('kft') || normalized.includes('rft') || normalized.includes('kidney') || normalized.includes('renal')) return 35;
        if (normalized.includes('lipid') || normalized.includes('cholesterol')) return 35;
        if (normalized.includes('thyroid') || normalized.includes('tsh') || normalized.includes('t3')) return 35;
        if (normalized.includes('urine') || normalized.includes('urinalysis')) return 15;
        if (normalized.includes('crp')) return 20;
        if (normalized.includes('dengue') || normalized.includes('malaria') || normalized.includes('widal') || normalized.includes('typhoid')) return 25;
        if (normalized.includes('vitamin d') || normalized.includes('d3')) return 45;
        if (normalized.includes('vitamin b12') || normalized.includes('b12')) return 40;
        if (normalized.includes('calcium') || normalized.includes('electrolyte')) return 25;
        return 20; // Default lab test baseline
    } else if (type.toUpperCase() === 'RADIOLOGY') {
        if (normalized.includes('x-ray') || normalized.includes('xray')) return 45;
        if (normalized.includes('ultrasound') || normalized.includes('usg') || normalized.includes('sonography')) return 65;
        if (normalized.includes('ct') || normalized.includes('hrct') || normalized.includes('computed')) return 130;
        if (normalized.includes('mri')) return 220;
        if (normalized.includes('ecg') || normalized.includes('ekg')) return 25;
        if (normalized.includes('echo')) return 85;
        if (normalized.includes('tmt')) return 75;
        if (normalized.includes('dexa')) return 90;
        return 50; // Default radiology baseline
    }
    return 0;
};

export const saveCompleteEMR = async (clinicId: number, doctorId: number, payload: any) => {
    const { appointmentId, patientId, assessmentData, prescriptions = [], labRequests = [], radiologyRequests = [], billingAmount } = payload;

    return await prisma.$transaction(async (tx) => {
        // 1. Save Assessment
        const recordTemplateId = assessmentData?.templateId ? Number(assessmentData.templateId) : null;

        await tx.medicalrecord.create({
            data: {
                clinicId,
                patientId,
                doctorId,
                templateId: recordTemplateId,
                type: 'ASSESSMENT',
                data: JSON.stringify(assessmentData || payload.findings || {}),
                isClosed: true
            }
        });

        // 2. Save Prescriptions
        for (const presc of prescriptions) {
            await tx.service_order.create({
                data: {
                    clinicId,
                    patientId,
                    doctorId,
                    type: 'PHARMACY',
                    testName: Array.isArray(presc.items)
                        ? presc.items.map((i: any) => `${i.medicineName || i.name} x${i.quantity}`).join(', ')
                        : (presc.medicineName || 'Prescription'),
                    amount: presc.totalAmount ? Number(presc.totalAmount) : (presc.amount ? Number(presc.amount) : 0),
                    paymentStatus: 'Pending',
                    testStatus: 'Pending',
                    result: JSON.stringify(presc)
                }
            });

            // Notify Pharmacy
            await tx.notification.create({
                data: {
                    clinicId,
                    department: 'pharmacy',
                    message: JSON.stringify({
                        patientId,
                        type: 'PHARMACY',
                        action: 'NEW_PRESCRIPTION',
                        text: `New prescription for Patient ID: ${patientId}`
                    })
                }
            });
        }

        // 3. Save Lab Requests
        for (const lab of labRequests) {
            const finalAmount = await resolveServicePrice(tx, clinicId, 'LAB', lab.testName, lab.amount);
            const order = await tx.service_order.create({
                data: {
                    clinicId,
                    patientId,
                    doctorId,
                    type: 'LAB',
                    testName: lab.testName,
                    amount: finalAmount,
                    paymentStatus: 'Pending',
                    testStatus: 'Pending'
                }
            });

            await tx.notification.create({
                data: {
                    clinicId,
                    department: 'laboratory',
                    message: JSON.stringify({
                        patientId,
                        orderId: order.id,
                        type: 'LAB',
                        action: 'NEW_ORDER',
                        text: `New lab order: ${lab.testName}`
                    })
                }
            });
        }

        // 4. Save Radiology Requests
        for (const rad of radiologyRequests) {
            const finalAmount = await resolveServicePrice(tx, clinicId, 'RADIOLOGY', rad.testName, rad.amount);
            const order = await tx.service_order.create({
                data: {
                    clinicId,
                    patientId,
                    doctorId,
                    type: 'RADIOLOGY',
                    testName: rad.testName,
                    amount: finalAmount,
                    paymentStatus: 'Pending',
                    testStatus: 'Pending'
                }
            });

            await tx.notification.create({
                data: {
                    clinicId,
                    department: 'radiology',
                    message: JSON.stringify({
                        patientId,
                        orderId: order.id,
                        type: 'RADIOLOGY',
                        action: 'NEW_ORDER',
                        text: `New radiology order: ${rad.testName}`
                    })
                }
            });
        }
        // 5. Update appointment status
        if (appointmentId) {
            await tx.appointment.update({
                where: { id: appointmentId },
                data: {
                    status: 'Completed',
                    queueStatus: 'Pending-Payment',
                    billingAmount: billingAmount ? Number(billingAmount) : undefined
                }
            });

            // Update patient status for billing tracking
            await tx.patient.update({
                where: { id: patientId },
                data: { status: 'Pending Payment' }
            });
        }

        return { success: true };
    });
};

export const getHistory = async (clinicId: number, patientId: number) => {
    const records = await prisma.medicalrecord.findMany({
        where: { clinicId, patientId },
        include: {
            formtemplate: true,
            patient: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' }
    });

    return records.map(r => ({
        ...r,
        patientName: (r as any).patient?.name || 'Unknown'
    }));
};

export const getPatientFullProfile = async (clinicId: number, patientId: number) => {
    const [patient, medicalRecords, serviceOrders, documents, appointments, invoices, medicalReports] = await Promise.all([
        prisma.patient.findUnique({
            where: { id: patientId }
        }),
        prisma.medicalrecord.findMany({
            where: { clinicId, patientId },
            include: { formtemplate: { select: { name: true } } },
            orderBy: { createdAt: 'desc' }
        }),
        prisma.service_order.findMany({
            where: { clinicId, patientId },
            orderBy: { createdAt: 'desc' }
        }),
        prisma.patient_document.findMany({
            where: { clinicId, patientId },
            orderBy: { createdAt: 'desc' }
        }),
        prisma.appointment.findMany({
            where: { clinicId, patientId },
            orderBy: { date: 'desc' }
        }),
        prisma.invoice.findMany({
            where: { clinicId, patientId },
            orderBy: { date: 'desc' }
        }),
        prisma.medical_report.findMany({
            where: { clinicId, patientId },
            include: { template: true },
            orderBy: { reportDate: 'desc' }
        })
    ]);

    if (!patient) throw new AppError('Patient not found', 404);

    const clinicalDocs = medicalRecords.filter(r => !['ASSESSMENT', 'NOTE', 'PRESCRIPTION'].includes(r.type)).map(r => {
        const parsedData = r.data && typeof r.data === 'object' ? r.data : (r.data ? JSON.parse(r.data as any) : {});
        return {
            id: r.id,
            clinicId: r.clinicId,
            patientId: r.patientId,
            type: r.type,
            name: parsedData.fileName || r.type,
            url: parsedData.fileUrl || parsedData.url,
            notes: parsedData.notes,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            isClinical: true
        };
    });

    return {
        patient,
        medicalRecords: medicalRecords.filter(r => ['ASSESSMENT', 'NOTE', 'PRESCRIPTION'].includes(r.type)).map(r => ({
            ...r,
            data: r.data ? JSON.parse(r.data as any) : {}
        })),
        serviceOrders: serviceOrders.map(o => ({
            ...o,
            result: o.result && (o.result.startsWith('{') || o.result.startsWith('[')) ? JSON.parse(o.result) : o.result
        })),
        documents: [...documents, ...clinicalDocs],
        appointments,
        invoices,
        medical_reports: medicalReports
    };
};



export const getAllAssessments = async (clinicId: number, doctorId?: number) => {
    const where: any = { clinicId };
    if (doctorId) {
        where.doctorId = doctorId;
    }

    const records = await prisma.medicalrecord.findMany({
        where,
        include: {
            formtemplate: true,
            patient: { select: { name: true, id: true } }
        },
        orderBy: { createdAt: 'desc' }
    });

    return records.map(r => ({
        ...r,
        patientName: (r as any).patient?.name || 'Unknown',
        patientId: (r as any).patient?.id,
        visitDate: r.visitDate || r.createdAt,
        date: r.visitDate || r.createdAt,
        status: 'Completed'
    }));
};


export const getDoctorStats = async (clinicId: number, doctorId: number) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const [todayAppts, totalPatientsCount, completedAppts, pendingAppts] = await Promise.all([
        prisma.appointment.count({
            where: {
                clinicId,
                doctorId,
                status: { notIn: ['Cancelled', 'cancelled', 'Rejected'] },
                date: { gte: today, lte: endOfDay }
            }
        }),
        prisma.medicalrecord.findMany({
            where: { clinicId, doctorId },
            distinct: ['patientId']
        }).then(res => res.length),
        prisma.appointment.count({
            where: { clinicId, doctorId, status: 'Completed', date: { gte: today, lte: endOfDay } }
        }),
        prisma.appointment.count({
            where: {
                clinicId,
                doctorId,
                OR: [
                    { status: 'Checked In' },
                    { queueStatus: 'Checked-In' },
                    { queueStatus: 'Checked In' }
                ],
                date: { gte: today, lte: endOfDay }
            }
        })
    ]);

    return {
        todayPatients: todayAppts,
        totalTreated: totalPatientsCount,
        completedAppointments: completedAppts,
        pendingAppointments: pendingAppts
    };
};

export const getDoctorActivities = async (clinicId: number, doctorId: number) => {
    const records = await prisma.medicalrecord.findMany({
        where: { clinicId, doctorId },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { patient: { select: { name: true } } }
    });

    return records.map(r => ({
        id: r.id,
        action: `Completed Assessment for ${(r as any).patient.name}`,
        time: r.createdAt
    }));
};

export const getFormTemplates = async (clinicId: number) => {
    console.log(`[DOCTOR SERVICE] Fetching templates for Clinic ID: ${clinicId}`);

    // Fetch both clinic-specific and global (null) templates
    const templates = await prisma.formtemplate.findMany({
        where: {
            OR: [
                { clinicId: Number(clinicId) },
                { clinicId: null }
            ],
            status: 'published'
        },
        orderBy: { name: 'asc' }
    });

    // Fallback: If no published templates found, return all available for this clinic (for debugging/setup)
    if (templates.length === 0) {
        return await prisma.formtemplate.findMany({
            where: {
                OR: [
                    { clinicId: Number(clinicId) },
                    { clinicId: null }
                ]
            },
            orderBy: { name: 'asc' }
        });
    }

    return templates;
};

export const getTemplateById = async (clinicId: number, templateId: number) => {
    const template = await prisma.formtemplate.findUnique({
        where: { id: templateId }
    });

    if (!template) throw new AppError('Template not found', 404);

    // Authorization: Must be global or belong to this clinic
    if (template.clinicId && template.clinicId !== clinicId) {
        throw new AppError('Unauthorized access to this template', 403);
    }

    return {
        ...template,
        fields: typeof template.fields === 'string' ? JSON.parse(template.fields) : template.fields
    };
};

export const getAssignedPatients = async (clinicId: number, doctorId: number) => {
    // 1. Get all unique patientIDs that have appointments with this doctor
    const appointments = await prisma.appointment.findMany({
        where: {
            clinicId,
            doctorId
        },
        select: { patientId: true },
        distinct: ['patientId'],
        orderBy: { updatedAt: 'desc' }
    });

    const patientIds = appointments.map(a => a.patientId);

    if (patientIds.length === 0) return [];

    // 2. Fetch patient details
    return await prisma.patient.findMany({
        where: {
            id: { in: patientIds },
            clinicId
        },
        include: {
            medicalrecord: {
                where: { clinicId },
                take: 1,
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true, type: true, data: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    });
};

export const getAllClinicPatients = async (clinicId: number) => {
    return await prisma.patient.findMany({
        where: { clinicId },
        include: {
            medicalrecord: {
                where: { clinicId },
                take: 1,
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true, type: true, data: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    });
};

export const getDoctorOrders = async (clinicId: number, doctorId: number) => {
    const orders = await prisma.service_order.findMany({
        where: {
            clinicId,
            doctorId
        },
        include: {
            patient: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' }
    });

    return orders.map(o => {
        let parsedResult = {};
        try {
            parsedResult = o.result ? JSON.parse(o.result) : {};
        } catch (e) {
            console.error("Failed to parse order result:", e);
        }

        return {
            id: o.id,
            date: o.createdAt,
            patientName: o.patient?.name || 'Unknown',
            type: o.type,
            details: o.testName,
            status: o.testStatus || 'Pending',
            priority: o.paymentStatus, // Using paymentStatus which often reflects priority in this DB or use a specific field if available
            amount: Number(o.amount || 0),
            result: parsedResult
        };
    });
};

export const createOrder = async (clinicId: number, doctorId: number, data: any) => {
    const { patientId, type, items, priority, notes, date, amount } = data;

    // Normalize type
    let orderType = 'LAB';
    if (type.toLowerCase().includes('rad')) orderType = 'RADIOLOGY';
    if (type.toLowerCase().includes('presc') || type.toLowerCase().includes('pharm')) orderType = 'PHARMACY';

    let testName = typeof items === 'string' ? items : '';
    let resultPayload: any = { priority, notes, date };
    let finalAmount = 0;

    if (orderType === 'PHARMACY' && Array.isArray(items) && items.length > 0) {
        const prescriptionItems = items.map((i: any) => ({
            inventoryId: i.inventoryId,
            medicineName: i.medicineName || i.name,
            quantity: Number(i.quantity) || 1,
            unitPrice: Number(i.unitPrice) || 0
        }));
        testName = prescriptionItems.map((i: any) => `${i.medicineName} x${i.quantity}`).join(', ');
        resultPayload.items = prescriptionItems;
        finalAmount = prescriptionItems.reduce((sum: number, it: any) => sum + (it.unitPrice * it.quantity), 0);
        if (amount && Number(amount) > 0) finalAmount = Number(amount);
    } else {
        finalAmount = await resolveServicePrice(prisma, clinicId, orderType, testName, amount);
    }

    resultPayload.amount = finalAmount;

    const order = await prisma.service_order.create({
        data: {
            clinicId,
            patientId: Number(patientId),
            doctorId,
            type: orderType,
            testName: testName || (typeof items === 'string' ? items : 'Prescription'),
            testStatus: 'Pending',
            paymentStatus: 'Pending',
            amount: finalAmount,
            result: JSON.stringify(resultPayload)
        }
    });

    // Notify Department
    let dept = 'laboratory';
    if (orderType === 'RADIOLOGY') dept = 'radiology';
    if (orderType === 'PHARMACY') dept = 'pharmacy';

    await prisma.notification.create({
        data: {
            clinicId,
            department: dept,
            message: JSON.stringify({ patientId, orderId: order.id, type: orderType, items, priority, notes, amount: finalAmount })
        }
    });

    return order;
};

export const getRevenueStats = async (clinicId: number, doctorId: number) => {
    // 1. Get all invoices for this doctor that are paid
    const paidInvoices = await prisma.invoice.findMany({
        where: {
            clinicId,
            doctorId,
            status: 'Paid'
        },
        select: { totalAmount: true, date: true, createdAt: true }
    });

    // 2. Get all invoices for this doctor that are pending (for outstanding info if needed, but the current return structure doesn't include it)
    // We'll focus on the requested return structure

    const totalEarnings = paidInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0);
    const totalConsultations = await prisma.appointment.count({
        where: { clinicId, doctorId, status: 'Completed' }
    });

    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const todayStr = today.toISOString().split('T')[0];

    let thisMonth = 0;
    let todayEarned = 0;

    // Daily buckets for chart
    const dailyMap = new Map<string, number>();

    paidInvoices.forEach(inv => {
        const d = new Date(inv.date || inv.createdAt);
        const dateStr = d.toISOString().split('T')[0];

        // Chart data
        dailyMap.set(dateStr, (dailyMap.get(dateStr) || 0) + Number(inv.totalAmount || 0));

        // Stats
        if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
            thisMonth += Number(inv.totalAmount || 0);
        }
        if (dateStr === todayStr) {
            todayEarned += Number(inv.totalAmount || 0);
        }
    });

    // Format chart data (last 7 active days or just map entries)
    const chartData = Array.from(dailyMap.entries())
        .map(([date, earnings]) => ({ date, earnings }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return {
        totalEarnings,
        thisMonth,
        today: todayEarned,
        totalConsultations,
        totalOutstanding: (await prisma.invoice.aggregate({
            where: { clinicId, doctorId, status: 'Pending' },
            _sum: { totalAmount: true }
        }))._sum.totalAmount || 0,
        chartData
    };
};

export const getDoctorSchedule = async (userId: number, clinicId?: number) => {
    let targetClinicId = clinicId;
    let staff = null;

    if (targetClinicId) {
        staff = await prisma.clinicstaff.findFirst({
            where: { userId, clinicId: targetClinicId }
        });
    }

    if (!staff) {
        staff = await prisma.clinicstaff.findFirst({
            where: { userId }
        });
        if (staff?.clinicId) {
            targetClinicId = staff.clinicId;
        }
    }

    if (!targetClinicId) {
        const firstClinic = await prisma.clinic.findFirst();
        targetClinicId = firstClinic?.id || 1;
    }

    const docId = staff?.id || userId;

    const clinic = await prisma.clinic.findUnique({
        where: { id: targetClinicId },
        select: { bookingConfig: true }
    });

    const config = clinic?.bookingConfig ? (typeof clinic.bookingConfig === 'string' ? JSON.parse(clinic.bookingConfig) : clinic.bookingConfig) : {};
    const defaultOffDays = config.offDays ?? [0, 6];
    const defaultSlots = config.timeSlots ?? [
        '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
        '01:00 PM', '01:30 PM', '02:00 PM', '02:30 PM', '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM'
    ];
    const defaultDuration = config.slotDuration ?? 30;

    const da = config.doctorAvailability || {};
    const docConfig = da[String(docId)] || da[docId] || {};

    return {
        doctorId: docId,
        offDays: docConfig.offDays ?? defaultOffDays,
        timeSlots: docConfig.timeSlots?.length ? docConfig.timeSlots : defaultSlots,
        slotDuration: docConfig.slotDuration ?? defaultDuration,
        startTime: docConfig.startTime || config.startTime || '09:00',
        endTime: docConfig.endTime || config.endTime || '17:00'
    };
};

export const updateDoctorSchedule = async (userId: number, clinicId?: number, data?: any) => {
    let targetClinicId = clinicId;
    let staff = null;

    if (targetClinicId) {
        staff = await prisma.clinicstaff.findFirst({
            where: { userId, clinicId: targetClinicId }
        });
    }

    if (!staff) {
        staff = await prisma.clinicstaff.findFirst({
            where: { userId }
        });
        if (staff?.clinicId) {
            targetClinicId = staff.clinicId;
        }
    }

    if (!targetClinicId) {
        const firstClinic = await prisma.clinic.findFirst();
        targetClinicId = firstClinic?.id || 1;
    }

    const docId = staff?.id || userId;

    const clinic = await prisma.clinic.findUnique({
        where: { id: targetClinicId },
        select: { bookingConfig: true }
    });

    const config = clinic?.bookingConfig ? (typeof clinic.bookingConfig === 'string' ? JSON.parse(clinic.bookingConfig) : clinic.bookingConfig) : {};
    if (!config.doctorAvailability) {
        config.doctorAvailability = {};
    }

    config.doctorAvailability[String(docId)] = {
        offDays: Array.isArray(data?.offDays) ? data.offDays : [0, 6],
        timeSlots: Array.isArray(data?.timeSlots) ? data.timeSlots : [],
        slotDuration: Number(data?.slotDuration) || 30,
        startTime: data?.startTime || '09:00',
        endTime: data?.endTime || '17:00'
    };

    await prisma.clinic.update({
        where: { id: targetClinicId },
        data: {
            bookingConfig: JSON.stringify(config)
        }
    });

    return config.doctorAvailability[String(docId)];
};
