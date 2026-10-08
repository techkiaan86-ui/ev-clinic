import { prisma } from '../lib/prisma.js';
import { sendAppointmentReminder } from '../services/whatsapp.service.js';

let reminderInterval: NodeJS.Timeout | null = null;

/**
 * Scan database for appointments scheduled in the next 24 hours and send WhatsApp reminders
 */
export const runAppointmentReminderJob = async () => {
    try {
        const now = new Date();
        const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        // Find upcoming appointments scheduled between now and next 24 hours
        // whose status is active ('Pending', 'Confirmed', 'Checked-In')
        const upcomingAppointments = await prisma.appointment.findMany({
            where: {
                date: {
                    gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
                    lte: next24Hours
                },
                status: {
                    in: ['Pending', 'Confirmed', 'Checked-In', 'checked in', 'confirmed', 'pending']
                },
                patient: {
                    phone: {
                        not: ''
                    }
                }
            },
            include: {
                patient: { select: { id: true, name: true, phone: true } },
                clinic: { select: { id: true, name: true } }
            }
        });

        if (upcomingAppointments.length === 0) {
            return;
        }

        console.log(`[REMINDER SCHEDULER] Found ${upcomingAppointments.length} upcoming appointments. Checking for reminders to send...`);

        // Check recent audit logs to avoid duplicate reminders within the same 12 hours
        const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
        const recentLogs = await prisma.auditlog.findMany({
            where: {
                action: 'WhatsApp Reminder Sent',
                timestamp: { gte: twelveHoursAgo }
            },
            select: { details: true }
        });

        const recentlyRemindedApptIds = new Set<number>();
        recentLogs.forEach(log => {
            try {
                if (log.details) {
                    const parsed = JSON.parse(log.details);
                    if (parsed.appointmentId) recentlyRemindedApptIds.add(parsed.appointmentId);
                }
            } catch (e) { }
        });

        for (const appt of upcomingAppointments) {
            if (!recentlyRemindedApptIds.has(appt.id)) {
                await sendAppointmentReminder(appt.id);
            }
        }
    } catch (error: any) {
        console.error('[REMINDER SCHEDULER ERROR]:', error.message);
    }
};

/**
 * Start background reminder scheduler
 * @param intervalMinutes Interval in minutes between scans (default: 30 minutes)
 */
export const startReminderScheduler = (intervalMinutes = 30) => {
    if (reminderInterval) {
        clearInterval(reminderInterval);
    }

    console.log(`⏰ [REMINDER SCHEDULER] Started WhatsApp appointment reminder worker (Scanning every ${intervalMinutes} mins)...`);

    // Run initial scan 10 seconds after server startup
    setTimeout(() => {
        runAppointmentReminderJob();
    }, 10000);

    // Schedule regular interval
    reminderInterval = setInterval(() => {
        runAppointmentReminderJob();
    }, intervalMinutes * 60 * 1000);
};

export const stopReminderScheduler = () => {
    if (reminderInterval) {
        clearInterval(reminderInterval);
        reminderInterval = null;
        console.log('⏰ [REMINDER SCHEDULER] Stopped.');
    }
};
