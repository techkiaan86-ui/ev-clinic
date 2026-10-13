import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppError } from '../utils/AppError.js';
import { isClinicLicenseExpired } from '../middlewares/auth.js';
import { isSlotConfirmed, isDoctorSlotBooked, isDoctorOnDayOff, normalizeTime } from '../utils/slotLock.js';
import { sendAppointmentBookingConfirmation } from './whatsapp.service.js';
import { getNextToken } from './reception.service.js';

const prisma = new PrismaClient();

export const getClinicBySubdomain = async (subdomain: string) => {
    const raw = decodeURIComponent(subdomain || '').trim();
    const isNum = !isNaN(Number(raw));

    // Allow lookup by subdomain (exact or lower), numeric ID, or name
    const clinic = await prisma.clinic.findFirst({
        where: {
            OR: [
                { subdomain: raw },
                { subdomain: raw.toLowerCase() },
                { id: isNum ? Number(raw) : -1 },
                { name: { contains: raw } }
            ]
        },
        select: {
            id: true,
            name: true,
            subdomain: true,
            logo: true,
            location: true,
            email: true,
            contact: true,
            bookingConfig: true,
            brandingColor: true,
            modules: true
        }
    });

    if (!clinic) throw new AppError('Clinic not found', 404);

    // Parse booking config if exists
    let config = null;
    if (clinic.bookingConfig) {
        try { config = typeof clinic.bookingConfig === 'string' ? JSON.parse(clinic.bookingConfig) : clinic.bookingConfig; } catch (e) { config = null; }
    }

    return { ...clinic, bookingConfig: config };
};

export const getClinicDoctors = async (clinicId: number) => {
    const numId = Number(clinicId);
    if (!numId || isNaN(numId)) return [];

    // First: Look for staff with role 'DOCTOR' or with DOCTOR in roles array
    const doctors = await prisma.clinicstaff.findMany({
        where: {
            clinicId: numId,
            OR: [
                { role: 'DOCTOR' },
                { roles: { contains: 'DOCTOR' } }
            ],
            user: { status: 'active' }
        },
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true
                }
            }
        }
    });

    if (doctors.length > 0) {
        return doctors;
    }

    // Fallback: If no staff is explicitly designated as DOCTOR (e.g. solo practitioner / dental clinic),
    // include active clinic staff so patients can still book an appointment
    const fallbackStaff = await prisma.clinicstaff.findMany({
        where: {
            clinicId: numId,
            user: { status: 'active' }
        },
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true
                }
            }
        }
    });

    return fallbackStaff;
};

export const getDoctorAvailability = async (doctorId: number, date?: string) => {
    // Basic availability logic (can be expanded later with actual appointment checks)
    const staff = await prisma.clinicstaff.findUnique({
        where: { id: doctorId },
        select: { roles: true, clinicId: true }
    });

    if (!staff) throw new AppError('Doctor not found', 404);

    const clinic = await prisma.clinic.findUnique({
        where: { id: staff.clinicId },
        select: { bookingConfig: true }
    });

    let config = { timeSlots: ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"] };
    if (clinic?.bookingConfig) {
        try {
            const parsed = JSON.parse(clinic.bookingConfig);
            if (parsed.timeSlots) config.timeSlots = parsed.timeSlots;
        } catch (e) { }
    }

    if (date) {
        let dateObj = new Date(date);
        if (!isNaN(dateObj.getTime())) {
            const startOfDay = new Date(dateObj);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(dateObj);
            endOfDay.setHours(23, 59, 59, 999);

            const confirmedAppts = await prisma.appointment.findMany({
                where: {
                    clinicId: staff.clinicId,
                    date: { gte: startOfDay, lte: endOfDay },
                    status: { in: ['Confirmed', 'Approved', 'Checked In', 'Completed', 'CONFIRMED', 'APPROVED', 'CHECKED IN', 'COMPLETED'] }
                },
                select: { time: true }
            });

            const lockedNorms = new Set(confirmedAppts.map(a => normalizeTime(a.time)));
            config.timeSlots = config.timeSlots.filter((slot: string) => !lockedNorms.has(normalizeTime(slot)));
        }
    }

    return config;
};

export const createPublicBooking = async (data: any) => {
    const { name, email, phone, password, doctorId, clinicId, date, time, notes, service } = data;

    const numericClinicId = Number(clinicId);
    const numericDoctorId = Number(doctorId);

    if (!numericClinicId || isNaN(numericClinicId)) {
        throw new AppError('Valid clinicId is required.', 400);
    }
    if (!numericDoctorId || isNaN(numericDoctorId)) {
        throw new AppError('Valid doctorId is required.', 400);
    }

    // 0. Verify clinic exists and license is not expired
    const targetClinic = await prisma.clinic.findUnique({
        where: { id: numericClinicId },
        select: { status: true, subscriptionEnd: true, isActive: true }
    });
    if (!targetClinic || isClinicLicenseExpired(targetClinic)) {
        throw new AppError('This clinic is currently inactive or its license has expired. Bookings are temporarily unavailable.', 403);
    }

    // 1. Find or Create User
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        const hashedPassword = await bcrypt.hash(password || 'Patient@123', 12);
        user = await prisma.user.create({
            data: {
                name,
                email,
                phone,
                password: hashedPassword,
                role: 'PATIENT'
            }
        });
    }

    // 2. Ensure Patient record exists for this clinic
    let patient = await prisma.patient.findFirst({
        where: { email, clinicId: numericClinicId }
    });

    if (!patient) {
        patient = await prisma.patient.create({
            data: {
                name,
                email,
                phone,
                clinicId: numericClinicId,
                status: 'Active'
            }
        });
    }

    // Prevent booking on Doctor's scheduled Day Off
    if (numericDoctorId && date) {
        const offDayCheck = await isDoctorOnDayOff(prisma, numericClinicId, numericDoctorId, date);
        if (offDayCheck.isOff) {
            throw new AppError(offDayCheck.reason || 'The doctor is not scheduled on this day.', 400);
        }
    }

    // Check if slot is already booked for this doctor
    const alreadyBooked = await isDoctorSlotBooked(prisma, numericClinicId, numericDoctorId, date, time);
    if (alreadyBooked) {
        throw new AppError(`The selected time slot (${time}) is already booked for this doctor. Please choose a different time slot.`, 400);
    }

    // Generate token number for queue
    let tokenNumber: number | null = null;
    try {
        tokenNumber = await getNextToken(numericClinicId);
    } catch (e) {
        console.error('Failed to generate token number:', e);
    }

    // 3. Create Appointment
    const appointment = await prisma.appointment.create({
        data: {
            clinicId: numericClinicId,
            patientId: patient.id,
            doctorId: numericDoctorId,
            date: new Date(date),
            time,
            notes,
            service: service || 'General Consultation',
            status: 'Pending',
            tokenNumber,
            source: 'Online Booking'
        }
    });

    // 4. Audit Log (non-blocking)
    prisma.auditlog.create({
        data: {
            action: 'Public Appointment Booked',
            performedBy: 'PATIENT',
            userId: user.id,
            clinicId,
            details: JSON.stringify({ appointmentId: appointment.id })
        }
    }).catch(err => console.error('[AUDIT ERROR]:', err));

    // 5. Send automated WhatsApp confirmation
    sendAppointmentBookingConfirmation(appointment.id).catch(err => console.error('[WHATSAPP BOOKING ERROR]:', err));

    return appointment;
};

export const getLiveTokens = async (subdomain: string) => {
    const isNum = !isNaN(Number(subdomain));
    const clinic = await prisma.clinic.findFirst({
        where: {
            OR: [
                { subdomain: subdomain },
                { id: isNum ? Number(subdomain) : -1 },
                { name: { contains: subdomain } }
            ]
        },
        select: {
            id: true,
            name: true,
            logo: true,
            brandingColor: true,
            location: true
        }
    });
    if (!clinic) throw new AppError('Clinic not found', 404);

    const now = new Date();
    // Broad window for timezone safety (yesterday to tomorrow)
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - 1);
    windowStart.setHours(0, 0, 0, 0);

    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 1);
    windowEnd.setHours(23, 59, 59, 999);

    const activeKeywords = [
        'checked in', 'checked-in', 'waiting', 'in consultation',
        'in-consultation', 'in progress', 'in-progress', 'pending', 'confirmed'
    ];

    const appointments = await prisma.appointment.findMany({
        where: {
            clinicId: clinic.id,
            status: { notIn: ['Cancelled', 'CANCELLED', 'cancelled', 'Rejected', 'REJECTED', 'rejected'] },
            OR: [
                {
                    date: {
                        gte: windowStart,
                        lte: windowEnd
                    }
                },
                {
                    createdAt: {
                        gte: windowStart,
                        lte: windowEnd
                    }
                },
                {
                    queueStatus: {
                        in: ['Checked In', 'Checked-In', 'checked in', 'checked-in', 'Waiting', 'waiting', 'In Consultation', 'In-Consultation', 'in-consultation', 'Pending', 'pending', 'Confirmed', 'confirmed']
                    }
                },
                {
                    status: {
                        in: ['Checked In', 'Checked-In', 'checked in', 'checked-in', 'Waiting', 'waiting', 'In Consultation', 'In-Consultation', 'in-consultation', 'Pending', 'pending', 'Confirmed', 'confirmed']
                    }
                }
            ]
        },
        include: {
            patient: { select: { name: true, phone: true } },
            doctor: {
                include: {
                    user: { select: { name: true } }
                }
            }
        },
        orderBy: [
            { tokenNumber: 'asc' },
            { createdAt: 'asc' }
        ]
    });

    const queue = appointments
        .filter(a => {
            const rawStatus = (a.status || '').toLowerCase().replace(/_/g, '-').trim();
            const rawQueue = (a.queueStatus || '').toLowerCase().replace(/_/g, '-').trim();

            if (rawStatus === 'completed' || rawStatus === 'cancelled' || rawStatus === 'rejected') return false;
            if (rawQueue === 'completed' || rawQueue === 'cancelled' || rawQueue === 'rejected') return false;

            return activeKeywords.some(k => rawStatus.includes(k) || rawQueue.includes(k)) || Boolean(a.tokenNumber);
        })
        .map((a, idx) => {
            let doctorName = 'General';
            if (a.doctor?.user?.name) {
                doctorName = `Dr. ${a.doctor.user.name}`;
            }
            return {
                id: a.id,
                tokenNumber: (a.tokenNumber !== null && a.tokenNumber !== undefined && a.tokenNumber > 0) ? a.tokenNumber : (idx + 1),
                status: a.queueStatus || a.status || 'Waiting',
                patientName: a.patient?.name || 'Patient',
                doctorName,
                time: a.time || ''
            };
        });

    return { clinic, queue };
};
