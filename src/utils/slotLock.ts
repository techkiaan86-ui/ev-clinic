import { PrismaClient } from '@prisma/client';

export const normalizeTime = (t: string): string => {
    if (!t) return '';
    let cleaned = t.trim().toUpperCase().replace(/\s+/g, '');
    if (/^\d:\d{2}/.test(cleaned)) {
        cleaned = '0' + cleaned;
    }
    return cleaned;
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
