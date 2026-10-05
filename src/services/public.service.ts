import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AppError } from '../utils/AppError.js';
import { isSlotConfirmed, normalizeTime } from '../utils/slotLock.js';

const prisma = new PrismaClient();

export const getClinicBySubdomain = async (subdomain: string) => {
    // Allow lookup by subdomain OR id (for robustness)
    const clinic = await prisma.clinic.findFirst({
        where: {
            OR: [
                { subdomain: subdomain },
                { id: !isNaN(Number(subdomain)) ? Number(subdomain) : -1 }
            ]
        },
        select: {
            id: true,
            name: true,
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
        try { config = JSON.parse(clinic.bookingConfig); } catch (e) { config = null; }
    }

    return { ...clinic, bookingConfig: config };
};

export const getClinicDoctors = async (clinicId: number) => {
    return await prisma.clinicstaff.findMany({
        where: {
            clinicId,
            role: 'DOCTOR',
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
        where: { email, clinicId }
    });

    if (!patient) {
        patient = await prisma.patient.create({
            data: {
                name,
                email,
                phone,
                clinicId,
                status: 'Active'
            }
        });
    }

    // Check if slot is already confirmed and locked
    const alreadyLocked = await isSlotConfirmed(prisma, Number(clinicId), date, time);
    if (alreadyLocked) {
        throw new AppError(`The selected time slot (${time}) is already confirmed and locked for another patient. Please choose a different time slot.`, 400);
    }

    // 3. Create Appointment
    const appointment = await prisma.appointment.create({
        data: {
            clinicId,
            patientId: patient.id,
            doctorId,
            date: new Date(date),
            time,
            notes,
            service: service || 'General Consultation',
            status: 'Pending',
            source: 'Online Booking'
        }
    });

    // 4. Audit Log
    await prisma.auditlog.create({
        data: {
            action: 'Public Appointment Booked',
            performedBy: 'PATIENT',
            userId: user.id,
            clinicId,
            details: JSON.stringify({ appointmentId: appointment.id })
        }
    });

    return appointment;
};

export const getLiveTokens = async (subdomain: string) => {
    const clinic = await prisma.clinic.findFirst({
        where: {
            OR: [
                { subdomain: subdomain },
                { id: !isNaN(Number(subdomain)) ? Number(subdomain) : -1 }
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

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const appointments = await prisma.appointment.findMany({
        where: {
            clinicId: clinic.id,
            status: { notIn: ['Cancelled', 'CANCELLED'] },
            OR: [
                {
                    date: {
                        gte: todayStart,
                        lte: todayEnd
                    }
                },
                {
                    createdAt: {
                        gte: todayStart,
                        lte: todayEnd
                    }
                },
                {
                    queueStatus: { in: ['Checked In', 'Checked-In', 'Waiting', 'In Consultation', 'In-Consultation', 'Pending', 'Pending-Payment'] }
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

    const queue = appointments.map((a, idx) => {
        let doctorName = 'General';
        if (a.doctor?.user?.name) {
            doctorName = `Dr. ${a.doctor.user.name}`;
        }
        return {
            id: a.id,
            tokenNumber: a.tokenNumber !== null && a.tokenNumber !== undefined ? a.tokenNumber : (idx + 1),
            status: a.queueStatus || a.status || 'Waiting',
            patientName: a.patient?.name || 'Patient',
            doctorName,
            time: a.time
        };
    });

    return { clinic, queue };
};
