import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import bcrypt from 'bcryptjs';

export const getClinicStats = async (clinicId: number) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [doctorCount, staffCount, todayAppts, totalPatients, todayRevenue, pendingBills, totalRevenue] = await Promise.all([
        prisma.clinicstaff.count({ where: { clinicId, role: 'DOCTOR' } }),
        prisma.clinicstaff.count({ where: { clinicId } }),
        prisma.appointment.count({
            where: {
                clinicId,
                date: { gte: today, lt: tomorrow }
            }
        }),
        prisma.patient.count({ where: { clinicId } }),
        prisma.invoice.aggregate({
            where: { clinicId, status: 'Paid', date: { gte: today, lt: tomorrow } },
            _sum: { totalAmount: true }
        }),
        prisma.invoice.count({ where: { clinicId, status: 'Pending' } }),
        prisma.invoice.aggregate({
            where: { clinicId, status: 'Paid' },
            _sum: { totalAmount: true }
        })
    ]);

    return {
        totalDoctors: doctorCount,
        totalStaff: staffCount,
        todayAppointments: todayAppts,
        totalPatients,
        todayRevenue: Number(todayRevenue._sum.totalAmount || 0),
        pendingBills,
        revenue: Number(totalRevenue._sum.totalAmount || 0)
    };
};

export const getClinicContext = async (clinicId: number) => {
    const clinic = await prisma.clinic.findUnique({
        where: { id: clinicId }
    });
    if (!clinic) throw new AppError('Clinic not found', 404);

    let modules = { pharmacy: true, radiology: true, laboratory: true, billing: true };
    if (clinic.modules) {
        try {
            modules = typeof clinic.modules === 'string' ? JSON.parse(clinic.modules) : clinic.modules;
        } catch (e) {
            console.error('Failed to parse clinic modules:', e);
        }
    }

    return {
        id: clinic.id,
        name: clinic.name,
        location: clinic.location,
        contact: clinic.contact,
        email: clinic.email,
        subdomain: clinic.subdomain,
        modules,
        brandingColor: clinic.brandingColor,
        status: clinic.status,
        documentTypes: clinic.documentTypes ? JSON.parse(clinic.documentTypes) : null,
        bookingConfig: clinic.bookingConfig ? (typeof clinic.bookingConfig === 'string' ? JSON.parse(clinic.bookingConfig) : clinic.bookingConfig) : null
    };
};

export const updateClinic = async (clinicId: number, data: any) => {
    const { name, location, contact, email, documentTypes, brandingColor, websiteConfig, bookingConfig } = data;

    // Merge websiteConfig into bookingConfig if provided
    let updatedBookingConfig: string | undefined = undefined;
    if (websiteConfig || bookingConfig) {
        const current = await prisma.clinic.findUnique({
            where: { id: clinicId },
            select: { bookingConfig: true }
        });

        let currentConfig: any = {};
        if (current?.bookingConfig) {
            try {
                currentConfig = typeof current.bookingConfig === 'string' ? JSON.parse(current.bookingConfig) : current.bookingConfig;
            } catch (e) {
                currentConfig = {};
            }
        }

        if (bookingConfig) {
            currentConfig = { ...currentConfig, ...(typeof bookingConfig === 'string' ? JSON.parse(bookingConfig) : bookingConfig) };
        }
        if (websiteConfig) {
            currentConfig.websiteConfig = websiteConfig;
        }

        updatedBookingConfig = JSON.stringify(currentConfig);
    }

    const updated = await prisma.clinic.update({
        where: { id: clinicId },
        data: {
            name: name || undefined,
            location: location || undefined,
            contact: contact || undefined,
            email: email || undefined,
            brandingColor: brandingColor || undefined,
            documentTypes: documentTypes ? JSON.stringify(documentTypes) : undefined,
            bookingConfig: updatedBookingConfig || undefined
        }
    });

    await prisma.auditlog.create({
        data: {
            action: 'Clinic Details Updated',
            performedBy: 'ADMIN',
            clinicId,
            details: JSON.stringify({ updates: Object.keys(data) })
        }
    });

    return {
        ...updated,
        documentTypes: updated.documentTypes ? JSON.parse(updated.documentTypes) : null,
        bookingConfig: updated.bookingConfig ? JSON.parse(updated.bookingConfig) : null
    };
};

export const getClinicActivities = async (clinicId: number) => {
    const logs = await prisma.auditlog.findMany({
        where: { clinicId },
        take: 10,
        orderBy: { timestamp: 'desc' }
    });

    return logs.map(log => ({
        id: log.id,
        action: log.action,
        user: log.performedBy,
        time: log.timestamp,
        details: log.details
    }));
};

export const getClinicStaff = async (clinicId: number) => {
    const staffRecords = await prisma.clinicstaff.findMany({
        where: {
            clinicId,
            role: { not: 'SUPER_ADMIN' }
        },
        include: {
            user: true
        }
    });

    return staffRecords.map(record => {
        let roles = [];
        try {
            roles = record.roles ? JSON.parse(record.roles) : [record.role];
        } catch (e) {
            roles = [record.role];
        }

        return {
            id: record.id,
            userId: record.userId,
            clinicId: record.clinicId,
            name: (record.user as any)?.name || 'Staff Member',
            email: (record.user as any)?.email || '',
            phone: (record.user as any)?.phone || '',
            status: (record.user as any)?.status || 'active',
            joined: (record.user as any)?.joined ? (record.user as any).joined.toISOString().split('T')[0] : (record.createdAt ? record.createdAt.toISOString().split('T')[0] : null),
            role: record.role,
            roles: roles,
            department: record.department,
            specialty: record.specialty
        };
    });
};

export const addStaff = async (clinicId: number, data: any) => {
    try {
        const { email, password, name, roles, phone, department, specialty } = data;

        // Fetch clinic enabled modules
        const clinicData = await prisma.clinic.findUnique({
            where: { id: clinicId },
            select: { modules: true }
        });

        let enabledModules: any = { pharmacy: true, radiology: true, laboratory: true, billing: true };
        if (clinicData?.modules) {
            try {
                enabledModules = typeof clinicData.modules === 'string' ? JSON.parse(clinicData.modules) : clinicData.modules;
            } catch (e) { }
        }

        // Validate requested roles against enabled modules
        const requestedRoles = Array.isArray(roles) ? roles : [roles];
        for (const r of requestedRoles) {
            const rUpper = String(r).toUpperCase();
            if ((rUpper === 'PHARMACY' || rUpper === 'PHARMACIST') && enabledModules.pharmacy === false) {
                throw new AppError('Pharmacy module is disabled for this clinic. Cannot assign Pharmacy role.', 400);
            }
            if ((rUpper === 'LAB' || rUpper === 'LABORATORY') && (enabledModules.laboratory === false || enabledModules.lab === false)) {
                throw new AppError('Laboratory module is disabled for this clinic. Cannot assign Laboratory role.', 400);
            }
            if (rUpper === 'RADIOLOGY' && enabledModules.radiology === false) {
                throw new AppError('Radiology module is disabled for this clinic. Cannot assign Radiology role.', 400);
            }
        }

        // Map common variations to valid Enum values
        let primaryRoleRaw = (roles && roles.length > 0) ? roles[0].toUpperCase() : 'RECEPTIONIST';
        if (primaryRoleRaw === 'LABORATORY') primaryRoleRaw = 'LAB';
        if (primaryRoleRaw === 'PHARMACIST') primaryRoleRaw = 'PHARMACY';

        const primaryRole = primaryRoleRaw;

        console.log(`[STAFF_SERVICE] Adding staff: ${email} to clinic ${clinicId} with role ${primaryRole}`);

        // Check if user exists
        let user: any = await prisma.user.findUnique({ where: { email } });

        if (!user) {
            if (!password) throw new AppError('Password is required for new users', 400);
            const hashedPassword = await bcrypt.hash(password, 12);
            user = await prisma.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    name,
                    phone,
                    status: 'active',
                    role: primaryRole as any
                }
            });
            console.log(`[STAFF_SERVICE] Created new user with ID: ${user.id}`);
        } else {
            // Update user's phone and primary role
            user = await prisma.user.update({
                where: { id: user.id },
                data: {
                    phone: phone || undefined,
                    role: primaryRole as any
                }
            });
            console.log(`[STAFF_SERVICE] Linked existing user id: ${user.id}`);
        }

        // Check if staff already exists in this clinic
        const existing = await prisma.clinicstaff.findFirst({
            where: {
                userId: user.id,
                clinicId
            }
        });

        if (existing) throw new AppError('User is already a staff member in this clinic', 400);

        const newStaff: any = await prisma.clinicstaff.create({
            data: {
                userId: user.id,
                clinicId,
                role: primaryRole as any,
                roles: JSON.stringify(roles || [primaryRole]),
                department,
                specialty
            },
            include: {
                user: true
            }
        });

        await prisma.auditlog.create({
            data: {
                action: 'Staff Added',
                performedBy: 'ADMIN',
                userId: user.id,
                clinicId,
                details: JSON.stringify({ name: user.name, roles, department })
            }
        });

        return {
            id: newStaff.id,
            userId: newStaff.userId,
            clinicId: newStaff.clinicId,
            name: newStaff.user?.name || user.name,
            email: newStaff.user?.email || user.email,
            role: newStaff.role,
            roles: roles || [newStaff.role],
            department: newStaff.department,
            specialty: newStaff.specialty,
            status: newStaff.user?.status || 'active',
            joined: newStaff.user?.joined ? newStaff.user.joined.toISOString().split('T')[0] : null,
            createdAt: newStaff.createdAt
        };
    } catch (error: any) {
        console.error(`[STAFF_SERVICE_ERROR] Failed to add staff:`, error);
        if (error instanceof AppError) throw error;

        if (error.code === 'P2002') {
            throw new AppError('A staff member with this information already exists', 400);
        }

        // Handle potential enum or database errors specifically to avoid 500
        if (error.message && (error.message.includes('not found in enum') || error.message.includes('Unknown argument'))) {
            throw new AppError(`Invalid role or data field selected: ${error.message}`, 400);
        }

        throw new AppError(`Staff creation failed: ${error.message}`, 500);
    }
};


export const updateStaff = async (clinicId: number, staffId: number, data: any) => {
    const { name, email, phone, roles, department, specialty, status } = data;
    const primaryRole = (roles && roles.length > 0) ? roles[0].toUpperCase() : undefined;

    const staff = await prisma.clinicstaff.findUnique({
        where: { id: staffId },
        include: { user: true }
    });

    if (!staff) throw new AppError('Staff record not found', 404);
    if (staff.clinicId !== clinicId) throw new AppError('Unauthorized: Staff does not belong to this clinic', 403);

    // Update user info if name/email/phone/status/role changed
    if (name || email || phone || status || primaryRole) {
        await prisma.user.update({
            where: { id: staff.userId },
            data: {
                name: name || undefined,
                email: email || undefined,
                phone: phone || undefined,
                status: status || undefined,
                role: primaryRole ? primaryRole as any : undefined
            }
        });
    }

    // Update staff info
    const updatedStaff = await prisma.clinicstaff.update({
        where: { id: staffId },
        data: {
            role: primaryRole ? primaryRole as any : undefined,
            roles: roles ? JSON.stringify(roles) : undefined,
            department: department || undefined,
            specialty: specialty || undefined
        },
        include: {
            user: true
        }
    });

    await prisma.auditlog.create({
        data: {
            action: 'Staff Updated',
            performedBy: 'ADMIN',
            userId: staff.userId,
            clinicId: staff.clinicId,
            details: JSON.stringify({ staffId, updates: Object.keys(data) })
        }
    });

    let finalRoles = [];
    try {
        finalRoles = updatedStaff.roles ? JSON.parse(updatedStaff.roles) : [updatedStaff.role];
    } catch (e) {
        finalRoles = [updatedStaff.role];
    }

    return {
        id: updatedStaff.id,
        userId: updatedStaff.userId,
        clinicId: updatedStaff.clinicId,
        name: (updatedStaff.user as any).name,
        email: (updatedStaff.user as any).email,
        phone: (updatedStaff.user as any).phone,
        role: updatedStaff.role,
        roles: finalRoles,
        department: updatedStaff.department,
        specialty: updatedStaff.specialty,
        status: (updatedStaff.user as any).status,
        joined: (updatedStaff.user as any).joined ? (updatedStaff.user as any).joined.toISOString().split('T')[0] : null,
        createdAt: updatedStaff.createdAt
    };
};

export const deleteClinicStaff = async (clinicId: number, staffId: number, userRole?: string) => {
    const staff = await prisma.clinicstaff.findUnique({
        where: { id: staffId }
    });

    if (!staff) throw new AppError('Staff record not found', 404);

    // Super admins can delete staff from any clinic, regular admins can only delete from their own clinic
    if (userRole !== 'SUPER_ADMIN' && staff.clinicId !== clinicId) {
        throw new AppError('Unauthorized: Staff does not belong to this clinic', 403);
    }

    const actualClinicId = staff.clinicId;

    await prisma.$transaction(async (tx) => {
        // 1. Check if user has other clinic associations
        const otherAssociations = await tx.clinicstaff.count({
            where: { userId: staff.userId, id: { not: staffId } }
        });

        // 2. Delete the specific clinic staff record
        await tx.clinicstaff.delete({
            where: { id: staffId }
        });

        // 3. If no other associations, delete user and their audit logs
        if (otherAssociations === 0) {
            // Delete audit logs first to satisfy foreign key constraints
            await tx.auditlog.deleteMany({
                where: { userId: staff.userId }
            });

            // Delete the user record
            await tx.user.delete({
                where: { id: staff.userId }
            });
        }

        // 4. Log the action (using clinic context if still exists, or global)
        await tx.auditlog.create({
            data: {
                action: 'Staff Deleted',
                performedBy: userRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN',
                clinicId: actualClinicId,
                details: JSON.stringify({
                    staffId,
                    userId: staff.userId,
                    note: otherAssociations === 0 ? 'User and AuditLogs deleted' : 'Staff unlinked, user preserved'
                })
            }
        });
    });

    return { success: true };
};

export const getFormTemplates = async (clinicId: number) => {
    let templates = await prisma.formtemplate.findMany({
        where: {
            OR: [
                { clinicId: Number(clinicId) },
                { clinicId: null }
            ]
        },
        orderBy: { name: 'asc' }
    });

    const standardTemplates = [
        {
            name: 'General Medical Assessment Template',
            specialty: 'General Practice',
            status: 'published',
            version: 1,
            fields: JSON.stringify([
                { id: 'chief_complaint', type: 'textarea', label: 'Chief Complaint', required: true, placeholder: "Describe patient's primary symptoms, complaints, and duration..." },
                { id: 'history_present_illness', type: 'textarea', label: 'History of Present Illness (HPI)', required: false, placeholder: 'Onset, location, duration, character, aggravating and relieving factors...' },
                { id: 'past_medical_history', type: 'textarea', label: 'Past Medical & Surgical History', required: false, placeholder: 'Chronic conditions, past surgeries, allergies, ongoing medications...' },
                { id: 'physical_examination', type: 'textarea', label: 'Physical & Systemic Examination', required: false, placeholder: 'General appearance, systemic findings (Cardiovascular, Respiratory, Abdominal, CNS)...' },
                { id: 'vital_signs_summary', type: 'text', label: 'Vital Signs Summary', required: false, placeholder: 'BP, Pulse, Temperature, SpO2, Respiratory Rate' },
                { id: 'provisional_diagnosis', type: 'textarea', label: 'Provisional Clinical Diagnosis & Treatment Plan', required: false, placeholder: 'Clinical impressions, medications prescribed, follow-up plan...' }
            ])
        },
        {
            name: 'Dental Clinical Assessment & Tooth Chart',
            specialty: 'Dentistry',
            status: 'published',
            version: 1,
            fields: JSON.stringify([
                { id: 'dental_complaint', type: 'textarea', label: 'Chief Dental Complaint', required: true, placeholder: 'Toothache, gum bleeding, sensitivity, dental trauma, swelling, broken restoration...' },
                { id: 'teeth_involved', type: 'text', label: 'Tooth / Teeth Number(s) Involved', required: false, placeholder: 'e.g. Tooth #18, Upper Right Quadrant, Lower Anterior (1-32 FDI)...' },
                { id: 'tooth_chart_indicator', type: 'dropdown', label: 'Interactive Odontogram Charting', required: false, options: ['Adult 32-Teeth Chart Active', 'Pediatric Deciduous Chart Active', 'Periodontal Screening Only'] },
                { id: 'intraoral_findings', type: 'textarea', label: 'Intraoral & Periodontal Examination', required: false, placeholder: 'Caries detection, gingivitis, periodontal pocket depth, tooth mobility, oral mucosa...' },
                { id: 'dental_procedure_indicated', type: 'dropdown', label: 'Dental Procedure Indicated', required: false, options: ['Dental Cleaning / Scaling', 'Composite Filling / Restoration', 'Root Canal Treatment (RCT)', 'Tooth Extraction', 'Crown / Bridge Placement', 'Orthodontic Evaluation', 'Dental Implant', 'Other Procedure'] },
                { id: 'oral_hygiene_instructions', type: 'textarea', label: 'Oral Hygiene & Post-Treatment Instructions', required: false, placeholder: 'Brushing technique, flossing, mouth rinse, dietary recommendations...' }
            ])
        },
        {
            name: 'Orthopedic Assessment Template',
            specialty: 'Orthopedics',
            status: 'published',
            version: 1,
            fields: JSON.stringify([
                { id: 'ortho_complaint', type: 'textarea', label: 'Chief Orthopedic Complaint & Affected Region', required: true, placeholder: 'Joint pain, stiffness, fracture, sports injury, swelling, trauma history...' },
                { id: 'affected_body_region', type: 'dropdown', label: 'Affected Joint / Anatomical Region', required: false, options: ['Cervical Spine / Neck', 'Shoulder (Left)', 'Shoulder (Right)', 'Elbow / Forearm', 'Wrist / Hand', 'Lumbar Spine / Low Back', 'Hip / Pelvis', 'Knee (Left)', 'Knee (Right)', 'Ankle / Foot', 'Other / Multiple Joints'] },
                { id: 'pain_scale', type: 'dropdown', label: 'Pain Severity Scale (1 - 10)', required: false, options: ['1 - Minimal', '2 - Mild', '3 - Mild', '4 - Moderate', '5 - Moderate', '6 - Moderately Severe', '7 - Severe', '8 - Very Severe', '9 - Extremely Severe', '10 - Maximum Pain'] },
                { id: 'range_of_motion', type: 'textarea', label: 'Range of Motion & Joint Examination', required: false, placeholder: 'Active/passive ROM, joint stability, deformity, swelling, local temperature, tenderness...' },
                { id: 'neurovascular_status', type: 'textarea', label: 'Neurovascular & Motor Assessment', required: false, placeholder: 'Peripheral pulses, motor power, sensory examination, deep tendon reflexes...' },
                { id: 'orthopedic_plan', type: 'textarea', label: 'Imaging & Treatment Recommendations', required: false, placeholder: 'X-Ray / MRI orders, splinting / bracing, physical therapy, surgical consult...' }
            ])
        }
    ];

    const existingNames = new Set(templates.map(t => t.name.toLowerCase()));
    for (const st of standardTemplates) {
        if (!existingNames.has(st.name.toLowerCase())) {
            try {
                const created = await prisma.formtemplate.create({
                    data: {
                        clinicId: Number(clinicId),
                        name: st.name,
                        specialty: st.specialty,
                        status: st.status,
                        version: st.version,
                        fields: st.fields
                    }
                });
                templates.push(created);
                existingNames.add(st.name.toLowerCase());
            } catch (err) {
                console.error(`Failed to auto-seed template ${st.name}:`, err);
            }
        }
    }

    return templates;
};

export const createFormTemplate = async (clinicId: number, data: any) => {
    const { name, specialty, fields, status, doctorId } = data;
    const template = await prisma.formtemplate.create({
        data: {
            clinicId,
            name,
            specialty: specialty || 'General',
            fields: typeof fields === 'string' ? fields : JSON.stringify(fields),
            status: status || 'published',
            doctorId: doctorId ? Number(doctorId) : null
        }
    });

    await prisma.auditlog.create({
        data: {
            action: 'Form Template Created',
            performedBy: 'ADMIN',
            clinicId,
            details: JSON.stringify({ templateId: template.id, name })
        }
    });

    return template;
};

export const deleteFormTemplate = async (id: number) => {
    const template = await prisma.formtemplate.delete({
        where: { id }
    });

    await prisma.auditlog.create({
        data: {
            action: 'Form Template Deleted',
            performedBy: 'ADMIN',
            clinicId: template.clinicId,
            details: JSON.stringify({ templateId: id, name: template.name })
        }
    });

    return template;
};

const DEFAULT_BOOKING_CONFIG = {
    enabled: true,
    services: ['Consultation', 'Follow-up', 'Emergency'],
    timeSlots: ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00'],
    selectedDoctors: [],
    offDays: [0, 6],
    holidays: [],
    doctorAvailability: {} as Record<string, { offDays: number[]; timeSlots: string[] }>
};

/** Get availability (days + time slots) for a specific doctor. Falls back to clinic default if not set. */
export const getDoctorAvailability = async (clinicId: number, doctorId: number) => {
    const config = await getBookingConfig(clinicId);
    const doctorConfig = (config.doctorAvailability || {})[String(doctorId)];
    return {
        offDays: doctorConfig?.offDays ?? config.offDays ?? [0, 6],
        timeSlots: (doctorConfig?.timeSlots?.length ? doctorConfig.timeSlots : config.timeSlots) ?? DEFAULT_BOOKING_CONFIG.timeSlots
    };
};

export const getBookingConfig = async (clinicId: number) => {
    const clinic = await prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { bookingConfig: true }
    });
    if (clinic?.bookingConfig) {
        try {
            return JSON.parse(clinic.bookingConfig);
        } catch {
            return DEFAULT_BOOKING_CONFIG;
        }
    }
    return DEFAULT_BOOKING_CONFIG;
};

export const updateBookingConfig = async (clinicId: number, config: any) => {
    const updated = await prisma.clinic.update({
        where: { id: clinicId },
        data: {
            bookingConfig: JSON.stringify(config)
        },
        select: { bookingConfig: true }
    });

    await prisma.auditlog.create({
        data: {
            action: 'Booking Config Updated',
            performedBy: 'ADMIN',
            clinicId,
            details: JSON.stringify({ config })
        }
    });

    return updated.bookingConfig ? JSON.parse(updated.bookingConfig) : null;
};

export const resetUserPassword = async (clinicId: number, userId: number, password: string) => {
    const staff = await prisma.clinicstaff.findFirst({
        where: { userId, clinicId }
    });
    if (!staff) throw new AppError('User does not belong to this clinic', 403);

    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
    });

    await prisma.auditlog.create({
        data: {
            action: 'Password Reset',
            performedBy: 'ADMIN',
            userId: userId,
            clinicId,
            details: JSON.stringify({ note: 'Admin reset password' })
        }
    });

    return { success: true };
};

export const getClinicServices = async (clinicId: number) => {
    return await prisma.clinic_service.findMany({
        where: { clinicId },
        orderBy: { name: 'asc' }
    });
};

export const createClinicService = async (clinicId: number, data: any) => {
    const { name, description, price, type, isActive } = data;
    const service = await prisma.clinic_service.create({
        data: {
            clinicId,
            name,
            description,
            price: price || 0,
            type: type || 'OTHER',
            isActive: isActive !== undefined ? isActive : true
        }
    });

    await prisma.auditlog.create({
        data: {
            action: 'Service Created',
            performedBy: 'ADMIN',
            clinicId,
            details: JSON.stringify({ serviceId: service.id, name, type, price })
        }
    });

    return service;
};

export const updateClinicService = async (clinicId: number, serviceId: number, data: any) => {
    const { name, description, price, type, isActive } = data;

    // Verify it belongs to clinic
    const existing = await prisma.clinic_service.findFirst({
        where: { id: serviceId, clinicId }
    });
    if (!existing) throw new AppError('Service not found or unauthorized', 404);

    const service = await prisma.clinic_service.update({
        where: { id: serviceId },
        data: {
            name: name ?? existing.name,
            description: description !== undefined ? description : existing.description,
            price: price !== undefined ? price : existing.price,
            type: type ?? existing.type,
            isActive: isActive !== undefined ? isActive : existing.isActive
        }
    });

    await prisma.auditlog.create({
        data: {
            action: 'Service Updated',
            performedBy: 'ADMIN',
            clinicId,
            details: JSON.stringify({ serviceId, updates: data })
        }
    });

    return service;
};

export const deleteClinicService = async (clinicId: number, serviceId: number) => {
    const existing = await prisma.clinic_service.findFirst({
        where: { id: serviceId, clinicId }
    });
    if (!existing) throw new AppError('Service not found or unauthorized', 404);

    await prisma.clinic_service.delete({
        where: { id: serviceId }
    });

    await prisma.auditlog.create({
        data: {
            action: 'Service Deleted',
            performedBy: 'ADMIN',
            clinicId,
            details: JSON.stringify({ serviceId, name: existing.name })
        }
    });

    return { success: true };
};
