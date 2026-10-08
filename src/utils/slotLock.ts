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

export const isDoctorOnDayOff = async (
    db: any,
    clinicId: number,
    doctorId: number,
    targetDate: Date | string
): Promise<{ isOff: boolean; reason?: string }> => {
    if (!targetDate || !clinicId || !doctorId) return { isOff: false };

    let dayOfWeek: number = -1;
    if (typeof targetDate === 'string') {
        const parts = targetDate.split('T')[0].split('-');
        if (parts.length === 3) {
            const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            dayOfWeek = d.getDay();
        } else {
            dayOfWeek = new Date(targetDate).getDay();
        }
    } else {
        dayOfWeek = new Date(targetDate).getDay();
    }

    if (dayOfWeek < 0 || isNaN(dayOfWeek)) return { isOff: false };

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = dayNames[dayOfWeek] || 'Selected Day';

    const clinic = await db.clinic.findUnique({
        where: { id: Number(clinicId) },
        select: { bookingConfig: true }
    });

    if (!clinic || !clinic.bookingConfig) return { isOff: false };

    try {
        const config = typeof clinic.bookingConfig === 'string' ? JSON.parse(clinic.bookingConfig) : clinic.bookingConfig;
        const doctorAvailability = config.doctorAvailability || {};
        const doctorConfig = doctorAvailability[String(doctorId)] || doctorAvailability[doctorId];

        let offDays: number[] = [];
        if (doctorConfig && Array.isArray(doctorConfig.offDays)) {
            offDays = doctorConfig.offDays;
        } else if (Array.isArray(config.offDays)) {
            offDays = config.offDays;
        }

        if (offDays.includes(dayOfWeek)) {
            return {
                isOff: true,
                reason: `The doctor is scheduled off on ${dayName}s (Day Off). Please choose another date.`
            };
        }
    } catch (e) {
        console.error('Error checking doctor off day:', e);
    }

    return { isOff: false };
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

    let targetYmd = '';
    if (typeof targetDate === 'string') {
        targetYmd = targetDate.split('T')[0];
    } else if (targetDate instanceof Date) {
        const y = targetDate.getFullYear();
        const m = String(targetDate.getMonth() + 1).padStart(2, '0');
        const d = String(targetDate.getDate()).padStart(2, '0');
        targetYmd = `${y}-${m}-${d}`;
    }

    let dateObj = new Date(targetDate);
    if (isNaN(dateObj.getTime()) && targetYmd) {
        const parts = targetYmd.split('-');
        if (parts.length === 3) {
            dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        }
    }

    // Broad window to capture any timezone offset
    const windowStart = new Date(dateObj.getTime() - 24 * 60 * 60 * 1000);
    const windowEnd = new Date(dateObj.getTime() + 24 * 60 * 60 * 1000);

    const existingAppts = await db.appointment.findMany({
        where: {
            clinicId: Number(clinicId),
            doctorId: Number(doctorId),
            ...(excludeAppointmentId ? { id: { not: Number(excludeAppointmentId) } } : {}),
            date: {
                gte: windowStart,
                lte: windowEnd
            },
            status: {
                notIn: ['Cancelled', 'cancelled', 'CANCELLED', 'Rejected', 'rejected', 'REJECTED', 'Outside', 'outside']
            },
            queueStatus: {
                notIn: ['Cancelled', 'cancelled', 'CANCELLED', 'Rejected', 'rejected', 'REJECTED', 'Outside', 'outside']
            }
        },
        select: { id: true, time: true, date: true }
    });

    const targetNorm = normalizeTime(time);

    return existingAppts.some((a: any) => {
        // Compare date in YYYY-MM-DD
        let aYmd = '';
        if (typeof a.date === 'string') {
            aYmd = a.date.split('T')[0];
        } else if (a.date instanceof Date) {
            const y = a.date.getFullYear();
            const m = String(a.date.getMonth() + 1).padStart(2, '0');
            const d = String(a.date.getDate()).padStart(2, '0');
            aYmd = `${y}-${m}-${d}`;
        }

        const dateMatches = !targetYmd || !aYmd || aYmd === targetYmd;
        const timeMatches = normalizeTime(a.time) === targetNorm;

        return dateMatches && timeMatches;
    });
};

export const isSlotConfirmed = async (
    db: any,
    clinicId: number,
    targetDate: Date | string,
    time: string,
    excludeAppointmentId?: number
): Promise<boolean> => {
    return isDoctorSlotBooked(db, clinicId, 0, targetDate, time, excludeAppointmentId);
};
