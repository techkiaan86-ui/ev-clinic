import { PrismaClient } from '@prisma/client';

export const normalizeTime = (t: string): string => {
    if (!t) return '';
    const cleaned = t.trim().toUpperCase();
    const match = cleaned.match(/^0?(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
    if (match) {
        let hours = parseInt(match[1], 10);
        const minutes = match[2];
        const ampm = match[3]?.toUpperCase();
        if (ampm) {
            if (ampm === 'PM' && hours < 12) hours += 12;
            if (ampm === 'AM' && hours === 12) hours = 0;
        }
        return `${String(hours).padStart(2, '0')}:${minutes}`;
    }
    return cleaned.replace(/\s+/g, '');
};

export const isDoctorSlotBooked = async (
    db: any,
    clinicId: number,
    doctorId: number,
    targetDate: Date | string,
    time: string,
    excludeAppointmentId?: number
): Promise<boolean> => {
    if (!time || !targetDate || !clinicId || !doctorId) return false;

    let dateObj = new Date(targetDate);
    if (isNaN(dateObj.getTime())) {
        const parts = String(targetDate).split('T')[0].split('-');
        if (parts.length === 3) {
            dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        }
    }
    if (isNaN(dateObj.getTime())) return false;

    const startOfDay = new Date(dateObj);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(dateObj);
    endOfDay.setHours(23, 59, 59, 999);

    const existingAppts = await db.appointment.findMany({
        where: {
            clinicId: Number(clinicId),
            doctorId: Number(doctorId),
            ...(excludeAppointmentId ? { id: { not: Number(excludeAppointmentId) } } : {}),
            date: {
                gte: startOfDay,
                lte: endOfDay
            },
            status: {
                notIn: ['Cancelled', 'cancelled', 'Rejected', 'rejected', 'Outside', 'outside']
            },
            queueStatus: {
                notIn: ['Cancelled', 'cancelled', 'Rejected', 'rejected', 'Outside', 'outside']
            }
        },
        select: { id: true, time: true }
    });

    const targetNorm = normalizeTime(time);
    return existingAppts.some((a: any) => normalizeTime(a.time) === targetNorm);
};

export const isSlotConfirmed = async (
    db: any,
    clinicId: number,
    targetDate: Date | string,
    time: string,
    excludeAppointmentId?: number
): Promise<boolean> => {
    if (!time || !targetDate || !clinicId) return false;

    let dateObj = new Date(targetDate);
    if (isNaN(dateObj.getTime())) {
        const parts = String(targetDate).split('T')[0].split('-');
        if (parts.length === 3) {
            dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        }
    }
    if (isNaN(dateObj.getTime())) return false;

    const startOfDay = new Date(dateObj);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(dateObj);
    endOfDay.setHours(23, 59, 59, 999);

    const confirmedAppts = await db.appointment.findMany({
        where: {
            clinicId: Number(clinicId),
            ...(excludeAppointmentId ? { id: { not: Number(excludeAppointmentId) } } : {}),
            date: {
                gte: startOfDay,
                lte: endOfDay
            },
            status: {
                in: ['Confirmed', 'Approved', 'Checked In', 'Completed', 'CONFIRMED', 'APPROVED', 'CHECKED IN', 'COMPLETED']
            }
        },
        select: { id: true, time: true }
    });

    const targetNorm = normalizeTime(time);
    return confirmedAppts.some((a: any) => normalizeTime(a.time) === targetNorm);
};
