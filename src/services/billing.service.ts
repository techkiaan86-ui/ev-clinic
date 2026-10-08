import { prisma } from '../lib/prisma.js';

/** Syncs specific invoiced items to 'Paid' */
const syncInvoiceItemsPayment = async (tx: any, invoiceId: string) => {
    const items = await tx.invoice_item.findMany({
        where: { invoiceId }
    });

    for (const item of items) {
        if (!item.serviceId) continue;
        try {
            if (item.serviceType === 'consultation') {
                await tx.appointment.updateMany({
                    where: { id: item.serviceId },
                    data: { isPaid: true, queueStatus: 'Paid' }
                });
            } else if (['lab', 'radiology', 'pharmacy'].includes(item.serviceType)) {
                await tx.service_order.updateMany({
                    where: { id: item.serviceId },
                    data: { paymentStatus: 'Paid' }
                });
            }
        } catch (err) {
            console.error(`Warning: Could not sync payment status for serviceId ${item.serviceId}:`, err);
        }
    }
};

const isModuleEnabled = (modulesData: any, serviceType: string): boolean => {
    if (!modulesData) return true;
    let parsed: any = modulesData;
    if (typeof modulesData === 'string') {
        try {
            parsed = JSON.parse(modulesData);
        } catch (e) {
            return true;
        }
    }
    const t = serviceType.toLowerCase();
    if (t === 'lab' || t === 'laboratory') {
        if (parsed.laboratory === false || parsed.lab === false) return false;
    }
    if (t === 'radiology') {
        if (parsed.radiology === false) return false;
    }
    if (t === 'pharmacy') {
        if (parsed.pharmacy === false) return false;
    }
    return true;
};

const calculateOrderAmount = (order: any, clinicServices: any[]): { actualAmount: number; description: string } => {
    let actualAmount = Number(order.amount || 0);
    let description = `${order.type} Order: ${order.testName}`;
    const orderType = (order.type || '').toUpperCase();

    // Check result payload
    let parsed: any = null;
    if (order.result) {
        try {
            parsed = typeof order.result === 'string' ? JSON.parse(order.result) : order.result;
        } catch (e) {}
    }

    if (orderType === 'PHARMACY') {
        if (parsed) {
            if (parsed.amount !== undefined && Number(parsed.amount) > 0) {
                actualAmount = Number(parsed.amount);
            } else if (parsed.totalAmount !== undefined && Number(parsed.totalAmount) > 0) {
                actualAmount = Number(parsed.totalAmount);
            } else if (parsed.unitPrice && parsed.quantity) {
                actualAmount = Number(parsed.unitPrice) * Number(parsed.quantity);
            } else if (parsed.items && Array.isArray(parsed.items)) {
                const itemSum = parsed.items.reduce((sum: number, it: any) => sum + ((Number(it.unitPrice) || 0) * (Number(it.quantity) || 1)), 0);
                if (itemSum > 0) actualAmount = itemSum;
            }

            if (parsed.items && Array.isArray(parsed.items)) {
                if (typeof parsed.items[0] === 'object') {
                    description = `Pharmacy: ${parsed.items.map((it: any) => `${it.medicineName || it.name} x${it.quantity || 1}`).join(', ')}`;
                } else {
                    description = `Pharmacy: ${parsed.items.join(', ')}`;
                }
            } else if (parsed.testName && parsed.quantity) {
                description = `Pharmacy: ${parsed.testName} x${parsed.quantity}`;
            } else if (parsed.items) {
                description = `Pharmacy: ${parsed.items}`;
            }
        }
    } else {
        // LAB or RADIOLOGY or other service orders
        if (actualAmount <= 0) {
            if (parsed && (parsed.amount || parsed.price)) {
                actualAmount = Number(parsed.amount || parsed.price);
            }
        }

        // If still 0, look up from clinic services
        if (actualAmount <= 0 && Array.isArray(clinicServices)) {
            const testNameLower = (order.testName || '').toLowerCase().trim();
            const matchedService = clinicServices.find(cs =>
                cs.type?.toUpperCase() === orderType &&
                (cs.name?.toLowerCase().trim() === testNameLower ||
                 testNameLower.includes(cs.name?.toLowerCase().trim()) ||
                 cs.name?.toLowerCase().trim().includes(testNameLower))
            );
            if (matchedService && matchedService.price) {
                actualAmount = Number(matchedService.price);
            }
        }

        // If still 0, provide standard baseline tariffs
        if (actualAmount <= 0) {
            const normalized = (order.testName || '').toLowerCase();
            if (orderType === 'LAB') {
                if (normalized.includes('cbc') || normalized.includes('hemogram')) actualAmount = 25;
                else if (normalized.includes('hb') || normalized.includes('hemoglobin')) actualAmount = 15;
                else if (normalized.includes('esr')) actualAmount = 10;
                else if (normalized.includes('sugar') || normalized.includes('glucose') || normalized.includes('fbs') || normalized.includes('rbs') || normalized.includes('ppbs')) actualAmount = 12;
                else if (normalized.includes('hba1c')) actualAmount = 30;
                else if (normalized.includes('lft') || normalized.includes('liver')) actualAmount = 40;
                else if (normalized.includes('kft') || normalized.includes('rft') || normalized.includes('kidney') || normalized.includes('renal')) actualAmount = 35;
                else if (normalized.includes('lipid') || normalized.includes('cholesterol')) actualAmount = 35;
                else if (normalized.includes('thyroid') || normalized.includes('tsh') || normalized.includes('t3')) actualAmount = 35;
                else if (normalized.includes('urine') || normalized.includes('urinalysis')) actualAmount = 15;
                else if (normalized.includes('crp')) actualAmount = 20;
                else if (normalized.includes('dengue') || normalized.includes('malaria') || normalized.includes('widal') || normalized.includes('typhoid')) actualAmount = 25;
                else if (normalized.includes('vitamin d') || normalized.includes('d3')) actualAmount = 45;
                else if (normalized.includes('vitamin b12') || normalized.includes('b12')) actualAmount = 40;
                else if (normalized.includes('calcium') || normalized.includes('electrolyte')) actualAmount = 25;
                else actualAmount = 20;
            } else if (orderType === 'RADIOLOGY') {
                if (normalized.includes('x-ray') || normalized.includes('xray')) actualAmount = 45;
                else if (normalized.includes('ultrasound') || normalized.includes('usg') || normalized.includes('sonography')) actualAmount = 65;
                else if (normalized.includes('ct') || normalized.includes('hrct') || normalized.includes('computed')) actualAmount = 130;
                else if (normalized.includes('mri')) actualAmount = 220;
                else if (normalized.includes('ecg') || normalized.includes('ekg')) actualAmount = 25;
                else if (normalized.includes('echo')) actualAmount = 85;
                else if (normalized.includes('tmt')) actualAmount = 75;
                else if (normalized.includes('dexa')) actualAmount = 90;
                else actualAmount = 50;
            }
        }
    }

    return { actualAmount, description };
};

export const getPendingBillingItems = async (clinicId: number, patientId: number) => {
    // Fetch clinic enabled modules & services
    const [clinic, clinicServices] = await Promise.all([
        prisma.clinic.findUnique({
            where: { id: clinicId },
            select: { modules: true }
        }),
        prisma.clinic_service.findMany({
            where: { clinicId, isActive: true }
        })
    ]);

    // Find all item IDs already in an active (Pending or Paid) invoice for this clinic
    const invoicedItems = await prisma.invoice_item.findMany({
        where: {
            invoice: {
                clinicId,
                status: { in: ['Pending', 'Paid'] }
            }
        },
        select: { serviceId: true, serviceType: true }
    });

    const invoicedApptIds = new Set(
        invoicedItems
            .filter(i => i.serviceType === 'consultation' && i.serviceId)
            .map(i => i.serviceId)
    );
    const invoicedOrderIds = new Set(
        invoicedItems
            .filter(i => i.serviceType !== 'consultation' && i.serviceId)
            .map(i => i.serviceId)
    );

    // 1. Unpaid Consultations (Appointments)
    const appointments = await prisma.appointment.findMany({
        where: {
            clinicId,
            patientId,
            isPaid: false,
            billingAmount: { gt: 0 },
            queueStatus: { notIn: ['Outside', 'outside'] },
            status: { notIn: ['Outside', 'outside'] }
        },
        orderBy: { date: 'desc' }
    });

    const pendingAppointments = appointments.filter(a => !invoicedApptIds.has(a.id));

    // 2. Unpaid Service Orders (Lab, Radiology, Pharmacy)
    const orders = await prisma.service_order.findMany({
        where: {
            clinicId,
            patientId,
            paymentStatus: 'Pending'
        },
        orderBy: { createdAt: 'desc' }
    });

    const pendingOrders = orders.filter(o => {
        if (invoicedOrderIds.has(o.id)) return false;
        if (!isModuleEnabled(clinic?.modules, o.type)) return false;
        return true;
    });

    return {
        consultations: pendingAppointments.map(a => ({
            id: a.id,
            type: 'consultation',
            description: `Consultation - ${a.service || 'General'}`,
            amount: Number(a.billingAmount || 0),
            date: a.date
        })),
        orders: pendingOrders.map(o => {
            const { actualAmount, description } = calculateOrderAmount(o, clinicServices);
            return {
                id: o.id,
                type: o.type.toLowerCase(),
                description,
                amount: actualAmount,
                date: o.createdAt
            };
        })
    };
};

export const getAllPendingBillingPatients = async (clinicId: number) => {
    const [clinic, clinicServices] = await Promise.all([
        prisma.clinic.findUnique({
            where: { id: clinicId },
            select: { modules: true }
        }),
        prisma.clinic_service.findMany({
            where: { clinicId, isActive: true }
        })
    ]);

    const invoicedItems = await prisma.invoice_item.findMany({
        where: {
            invoice: {
                clinicId,
                status: { in: ['Pending', 'Paid'] }
            }
        },
        select: { serviceId: true, serviceType: true }
    });

    const invoicedApptIds = new Set(
        invoicedItems
            .filter(i => i.serviceType === 'consultation' && i.serviceId)
            .map(i => i.serviceId)
    );
    const invoicedOrderIds = new Set(
        invoicedItems
            .filter(i => i.serviceType !== 'consultation' && i.serviceId)
            .map(i => i.serviceId)
    );

    const appointments = await prisma.appointment.findMany({
        where: {
            clinicId,
            isPaid: false,
            billingAmount: { gt: 0 },
            queueStatus: { notIn: ['Outside', 'outside'] },
            status: { notIn: ['Outside', 'outside'] }
        },
        include: {
            patient: true
        },
        orderBy: { date: 'desc' }
    });

    const pendingAppointments = appointments.filter(a => !invoicedApptIds.has(a.id));

    const orders = await prisma.service_order.findMany({
        where: {
            clinicId,
            paymentStatus: 'Pending'
        },
        include: {
            patient: true
        },
        orderBy: { createdAt: 'desc' }
    });

    const pendingOrders = orders.filter(o => {
        if (invoicedOrderIds.has(o.id)) return false;
        if (!isModuleEnabled(clinic?.modules, o.type)) return false;
        return true;
    });

    const patientMap = new Map<number, any>();

    for (const appt of pendingAppointments) {
        if (!appt.patient) continue;
        const pId = appt.patientId;
        if (!patientMap.has(pId)) {
            patientMap.set(pId, {
                patientId: pId,
                patient: appt.patient,
                consultations: [],
                orders: [],
                totalAmount: 0
            });
        }
        const data = patientMap.get(pId);
        data.consultations.push({
            id: appt.id,
            type: 'consultation',
            description: `Consultation - ${appt.service || 'General'}`,
            amount: Number(appt.billingAmount || 0),
            date: appt.date
        });
        data.totalAmount += Number(appt.billingAmount || 0);
    }

    for (const order of pendingOrders) {
        if (!order.patient) continue;
        const pId = order.patientId;
        if (!patientMap.has(pId)) {
            patientMap.set(pId, {
                patientId: pId,
                patient: order.patient,
                consultations: [],
                orders: [],
                totalAmount: 0
            });
        }
        const data = patientMap.get(pId);
        const { actualAmount, description } = calculateOrderAmount(order, clinicServices);

        data.orders.push({
            id: order.id,
            type: order.type.toLowerCase(),
            description,
            amount: actualAmount,
            date: order.createdAt
        });
        data.totalAmount += actualAmount;
    }

    return Array.from(patientMap.values());
};

export const getAccountingDashboardStats = async (clinicId: number) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const [invoices, paidToday, pendingSum, pendingCount] = await Promise.all([
        prisma.invoice.findMany({
            where: { clinicId },
            include: { patient: { select: { name: true } } },
            orderBy: { date: 'desc' },
            take: 10
        }),
        prisma.invoice.aggregate({
            where: {
                clinicId,
                status: 'Paid',
                date: { gte: todayStart, lt: todayEnd }
            },
            _sum: { totalAmount: true }
        }),
        prisma.invoice.aggregate({
            where: { clinicId, status: 'Pending' },
            _sum: { totalAmount: true }
        }),
        prisma.invoice.count({
            where: { clinicId, status: 'Pending' }
        })
    ]);

    return {
        todayIncome: Number(paidToday._sum.totalAmount || 0),
        pendingPayments: Number(pendingSum._sum.totalAmount || 0),
        expenses: 0,
        pendingInvoicesCount: pendingCount,
        recentInvoices: invoices
    };
};

export const getInvoices = async (clinicId: number, filters?: { date?: string; patientName?: string }) => {
    const where: any = { clinicId };

    if (filters?.date) {
        const start = new Date(filters.date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        where.createdAt = {
            gte: start,
            lt: end
        };
    }

    if (filters?.patientName && filters.patientName.trim() !== '') {
        where.patient = {
            name: {
                contains: filters.patientName.trim()
            }
        };
    }

    return await prisma.invoice.findMany({
        where,
        include: {
            patient: true,
            items: true
        },
        orderBy: { createdAt: 'desc' }
    });
};

export const updateInvoiceStatus = async (clinicId: number, id: string, status: string, paymentMethod?: string) => {
    return await prisma.$transaction(async (tx) => {
        const existingInvoice = await tx.invoice.findFirst({
            where: { id, clinicId }
        });

        if (!existingInvoice) {
            const err: any = new Error('Invoice not found');
            err.statusCode = 404;
            throw err;
        }

        if (existingInvoice.status === 'Paid') {
            const err: any = new Error('Payment already completed. This invoice is locked.');
            err.statusCode = 400;
            throw err;
        }

        const invoice = await tx.invoice.update({
            where: { id, clinicId },
            data: {
                status,
                paymentMethod: paymentMethod || undefined
            }
        });

        if (status === 'Paid') {
            await syncInvoiceItemsPayment(tx, id);
        }

        return invoice;
    }, { maxWait: 10000, timeout: 25000 });
};

export const createInvoice = async (clinicId: number, data: any) => {
    const { patientId, visitId, items, status, paymentMethod, createdBy } = data;

    const pId = Number(patientId);
    if (!pId || isNaN(pId)) {
        throw new Error('Invalid Patient. Please select a patient.');
    }

    // Fetch clinic enabled modules
    const clinic = await prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { modules: true }
    });

    // Pre-validate items before opening transaction
    for (const item of items) {
        if (!isModuleEnabled(clinic?.modules, item.type)) {
            const err: any = new Error(`The ${item.type.toUpperCase()} module is disabled for this clinic.`);
            err.statusCode = 400;
            throw err;
        }
        if (item.type === 'consultation') {
            const appt = await prisma.appointment.findFirst({
                where: { id: Number(item.id), clinicId }
            });
            if (!appt || appt.isPaid) {
                const err: any = new Error(`Consultation service (ID: ${item.id}) has already been paid and locked.`);
                err.statusCode = 400;
                throw err;
            }
        } else if (['lab', 'radiology', 'pharmacy'].includes(item.type)) {
            const order = await prisma.service_order.findFirst({
                where: { id: Number(item.id), clinicId }
            });
            if (!order || order.paymentStatus === 'Paid') {
                const err: any = new Error(`${item.type.toUpperCase()} service (ID: ${item.id}) has already been paid and locked.`);
                err.statusCode = 400;
                throw err;
            }
        }

        const existingInvoiced = await prisma.invoice_item.findFirst({
            where: {
                serviceId: Number(item.id),
                serviceType: item.type,
                invoice: {
                    clinicId,
                    status: { in: ['Pending', 'Paid'] }
                }
            }
        });
        if (existingInvoiced) {
            const err: any = new Error(`Service item "${item.description || item.id}" has already been invoiced or paid.`);
            err.statusCode = 400;
            throw err;
        }
    }

    const totalAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    return await prisma.$transaction(async (tx) => {
        const invoiceId = `INV-${Math.floor(10000 + Math.random() * 90000)}-${Date.now().toString().slice(-4)}`;

        const invoice = await tx.invoice.create({
            data: {
                id: invoiceId,
                clinicId,
                patientId: pId,
                visitId: visitId ? Number(visitId) : undefined,
                totalAmount,
                status: status || 'Pending',
                paymentMethod,
                createdBy
            }
        });

        // Create Invoice Items
        for (const item of items) {
            await tx.invoice_item.create({
                data: {
                    invoiceId: invoice.id,
                    serviceType: item.type,
                    serviceId: Number(item.id),
                    description: item.description,
                    amount: Number(item.amount || 0)
                }
            });
        }

        if (invoice.status === 'Paid') {
            await syncInvoiceItemsPayment(tx, invoice.id);
        }

        return invoice;
    }, { maxWait: 10000, timeout: 25000 });
};

export const markItemOutside = async (clinicId: number, id: number, type: string) => {
    const itemType = type.toLowerCase();
    if (itemType === 'consultation') {
        const appt = await prisma.appointment.findFirst({
            where: { id, clinicId }
        });
        if (!appt) {
            const err: any = new Error('Appointment not found');
            err.statusCode = 404;
            throw err;
        }
        return await prisma.appointment.update({
            where: { id },
            data: {
                queueStatus: 'Outside',
                status: 'Outside'
            }
        });
    } else {
        const order = await prisma.service_order.findFirst({
            where: { id, clinicId }
        });
        if (!order) {
            const err: any = new Error('Service order not found');
            err.statusCode = 404;
            throw err;
        }
        return await prisma.service_order.update({
            where: { id },
            data: {
                paymentStatus: 'Outside',
                testStatus: 'Outside'
            }
        });
    }
};

