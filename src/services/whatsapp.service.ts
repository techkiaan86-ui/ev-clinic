import { prisma } from '../lib/prisma.js';

export interface WhatsAppMessagePayload {
    to: string;
    message: string;
    clinicId?: number;
}

/**
 * Clean and format phone number for WhatsApp
 */
export const formatPhoneNumber = (phone: string): string => {
    if (!phone) return '';
    // Remove all non-numeric characters except leading +
    let cleaned = phone.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) {
        cleaned = cleaned.substring(1);
    }
    return cleaned;
};

/**
 * Generate a direct WhatsApp Web URL for manual 1-click messaging
 */
export const generateWhatsAppWebUrl = (phone: string, message: string): string => {
    const cleanPhone = formatPhoneNumber(phone);
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
};

/**
 * Send WhatsApp Message via API (Twilio / Meta Cloud / UltraMsg / Generic Webhook / Mock fallback)
 */
export const sendWhatsAppMessage = async (toPhone: string, message: string, clinicId?: number): Promise<{ success: boolean; mode: string; messageId?: string }> => {
    const cleanPhone = formatPhoneNumber(toPhone);
    if (!cleanPhone) {
        console.warn('[WHATSAPP] Invalid or missing phone number:', toPhone);
        return { success: false, mode: 'invalid_phone' };
    }

    const whatsappApiUrl = process.env.WHATSAPP_API_URL;
    const whatsappToken = process.env.WHATSAPP_API_TOKEN;

    if (whatsappApiUrl) {
        try {
            const res = await fetch(whatsappApiUrl, {
                method: 'POST',
                headers: {
                    ...(whatsappToken ? { 'Authorization': `Bearer ${whatsappToken}` } : {}),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    to: cleanPhone,
                    recipient_type: 'individual',
                    type: 'text',
                    text: { body: message },
                    message: message, // fallback payload for generic webhooks
                    phone: cleanPhone
                })
            });

            const data: any = await res.json().catch(() => ({}));
            console.log(`[WHATSAPP API SENT] To: ${cleanPhone} | Status: ${res.status}`);
            return { success: true, mode: 'api', messageId: data?.id || data?.messageId };
        } catch (error: any) {
            console.error(`[WHATSAPP API ERROR] Failed to send to ${cleanPhone}:`, error.message);
        }
    }

    // Standard Log / Mock mode (production safe and testable)
    console.log(`\n📱 ================== [WHATSAPP MESSAGE DISPATCHED] ==================`);
    console.log(`📞 To: ${cleanPhone}`);
    console.log(`🏢 Clinic ID: ${clinicId || 'System'}`);
    console.log(`💬 Content:\n${message}`);
    console.log(`=======================================================================\n`);

    return { success: true, mode: 'logged' };
};

/**
 * Detect language preference ('fr' | 'ar' | 'en')
 */
const detectLanguage = (patient: any, clinic: any): 'fr' | 'ar' | 'en' => {
    if (patient?.preferredLanguage === 'fr' || patient?.language === 'fr') return 'fr';
    if (patient?.preferredLanguage === 'ar' || patient?.language === 'ar') return 'ar';
    if (patient?.preferredLanguage === 'en' || patient?.language === 'en') return 'en';
    
    // Check clinic country/default
    if (clinic?.country === 'France' || clinic?.country === 'FR') return 'fr';
    if (clinic?.country === 'Lebanon' || clinic?.country === 'LB') {
        return patient?.phone?.startsWith('+33') ? 'fr' : 'ar';
    }
    return 'en';
};

/**
 * Send Appointment Booking Confirmation WhatsApp Message
 */
export const sendAppointmentBookingConfirmation = async (appointmentId: number) => {
    try {
        const appointment = await prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: {
                patient: true,
                clinic: true,
                doctor: {
                    include: {
                        user: { select: { name: true } }
                    }
                }
            }
        });

        if (!appointment || !appointment.patient?.phone) return null;

        const lang = detectLanguage(appointment.patient, appointment.clinic);
        const patientName = appointment.patient.name || 'Valued Patient';
        const clinicName = appointment.clinic.name || 'EV Clinic';
        const doctorName = appointment.doctor?.user?.name || 'Assigned Specialist';
        const locale = lang === 'fr' ? 'fr-FR' : lang === 'ar' ? 'ar-SA' : 'en-US';
        const formattedDate = new Date(appointment.date).toLocaleDateString(locale, {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
        const apptTime = appointment.time || 'Scheduled Time';
        const tokenStr = appointment.tokenNumber ? `\n🔢 Token Number: *#${appointment.tokenNumber}*` : '';
        const serviceName = appointment.service || 'Consultation';
        const clinicContact = appointment.clinic.contact || appointment.clinic.email || '';

        let message = '';
        if (lang === 'fr') {
            message =
                `🏥 *${clinicName}* - Confirmation de Rendez-vous\n\n` +
                `Cher/Chère *${patientName}*,\n` +
                `Votre rendez-vous a été confirmé avec succès ! ✅\n\n` +
                `📅 *Date:* ${formattedDate}\n` +
                `⏰ *Heure:* ${apptTime}${tokenStr ? `\n🔢 N° de Ticket: *#${appointment.tokenNumber}*` : ''}\n` +
                `👨‍⚕️ *Médecin:* Dr. ${doctorName}\n` +
                `🩺 *Service:* ${serviceName}\n` +
                `📍 *Lieu:* ${appointment.clinic.location || 'Clinique'}\n` +
                (clinicContact ? `📞 *Contact:* ${clinicContact}\n\n` : '\n') +
                `⚠️ _Merci de vous présenter 10 minutes avant l'heure prévue._\n` +
                `Merci de votre confiance en ${clinicName} !`;
        } else if (lang === 'ar') {
            message =
                `🏥 *${clinicName}* - تأكيد حجز الموعد\n\n` +
                `عزيزي/عزيزتي *${patientName}*،\n` +
                `تم تأكيد موعدك الطبي بنجاح! ✅\n\n` +
                `📅 *التاريخ:* ${formattedDate}\n` +
                `⏰ *الوقت:* ${apptTime}${tokenStr ? `\n🔢 رقم الدور: *#${appointment.tokenNumber}*` : ''}\n` +
                `👨‍⚕️ *الطبيب المعالج:* د. ${doctorName}\n` +
                `🩺 *الخدمة:* ${serviceName}\n` +
                `📍 *الموقع:* ${appointment.clinic.location || 'العيادة'}\n` +
                (clinicContact ? `📞 *للتواصل:* ${clinicContact}\n\n` : '\n') +
                `⚠️ _يرجى الحضور قبل الموعد بـ 10 دقائق._\n` +
                `شكراً لاختيارك ${clinicName}!`;
        } else {
            message =
                `🏥 *${clinicName}* - Appointment Confirmation\n\n` +
                `Dear *${patientName}*,\n` +
                `Your appointment has been successfully scheduled! ✅\n\n` +
                `📅 *Date:* ${formattedDate}\n` +
                `⏰ *Time:* ${apptTime}${tokenStr}\n` +
                `👨‍⚕️ *Doctor:* Dr. ${doctorName}\n` +
                `🩺 *Service:* ${serviceName}\n` +
                `📍 *Location:* ${appointment.clinic.location || 'Clinic Facility'}\n` +
                (clinicContact ? `📞 *Contact:* ${clinicContact}\n\n` : '\n') +
                `⚠️ _Please arrive 10 minutes prior to your scheduled time._\n` +
                `Thank you for choosing ${clinicName}!`;
        }

        const res = await sendWhatsAppMessage(appointment.patient.phone, message, appointment.clinicId);

        // Record Audit Log (non-blocking)
        prisma.auditlog.create({
            data: {
                action: 'WhatsApp Confirmation Sent',
                performedBy: 'SYSTEM_WHATSAPP',
                clinicId: appointment.clinicId,
                details: JSON.stringify({
                    appointmentId,
                    phone: appointment.patient.phone,
                    language: lang,
                    status: res.mode
                })
            }
        }).catch(err => console.error('[WHATSAPP AUDIT] Error:', err));

        return { success: true, message, whatsappUrl: generateWhatsAppWebUrl(appointment.patient.phone, message) };
    } catch (err: any) {
        console.error('[WHATSAPP SERVICE] Confirmation error:', err);
        return null;
    }
};

/**
 * Send Upcoming Appointment Reminder WhatsApp Message
 */
export const sendAppointmentReminder = async (appointmentId: number) => {
    try {
        const appointment = await prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: {
                patient: true,
                clinic: true,
                doctor: {
                    include: {
                        user: { select: { name: true } }
                    }
                }
            }
        });

        if (!appointment || !appointment.patient?.phone) return null;

        const lang = detectLanguage(appointment.patient, appointment.clinic);
        const patientName = appointment.patient.name || 'Valued Patient';
        const clinicName = appointment.clinic.name || 'EV Clinic';
        const doctorName = appointment.doctor?.user?.name || 'Assigned Specialist';
        const locale = lang === 'fr' ? 'fr-FR' : lang === 'ar' ? 'ar-SA' : 'en-US';
        const formattedDate = new Date(appointment.date).toLocaleDateString(locale, {
            weekday: 'long',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
        const apptTime = appointment.time || 'Scheduled Time';
        const clinicContact = appointment.clinic.contact || appointment.clinic.email || '';

        let message = '';
        if (lang === 'fr') {
            message =
                `⏰ *Rappel de Rendez-vous Médical*\n\n` +
                `Cher/Chère *${patientName}*,\n` +
                `Ceci est un rappel pour votre prochain rendez-vous à la clinique *${clinicName}* :\n\n` +
                `📅 *Date:* ${formattedDate}\n` +
                `⏰ *Heure:* ${apptTime}${appointment.tokenNumber ? `\n🔢 N° de Ticket: *#${appointment.tokenNumber}*` : ''}\n` +
                `👨‍⚕️ *Médecin:* Dr. ${doctorName}\n` +
                `📍 *Lieu:* ${appointment.clinic.location || 'Clinique'}\n` +
                (clinicContact ? `📞 *Questions / Modification:* ${clinicContact}\n\n` : '\n') +
                `_Nous avons hâte de vous accueillir. Merci d'arriver 10 minutes à l'avance._`;
        } else if (lang === 'ar') {
            message =
                `⏰ *تذكير بالموعد الطبي القادم*\n\n` +
                `عزيزي/عزيزتي *${patientName}*،\n` +
                `نود تذكيرك بموعدك الطبي القادم في *${clinicName}*:\n\n` +
                `📅 *التاريخ:* ${formattedDate}\n` +
                `⏰ *الوقت:* ${apptTime}${appointment.tokenNumber ? `\n🔢 رقم الدور: *#${appointment.tokenNumber}*` : ''}\n` +
                `👨‍⚕️ *الطبيب:* د. ${doctorName}\n` +
                `📍 *الموقع:* ${appointment.clinic.location || 'العيادة'}\n` +
                (clinicContact ? `📞 *للاستفسار / التعديل:* ${clinicContact}\n\n` : '\n') +
                `_نتطلع لخدمتك، يرجى الحضور قبل الموعد بـ 10 دقائق._`;
        } else {
            message =
                `⏰ *Upcoming Appointment Reminder*\n\n` +
                `Dear *${patientName}*,\n` +
                `This is a friendly reminder for your upcoming medical visit at *${clinicName}*:\n\n` +
                `📅 *Date:* ${formattedDate}\n` +
                `⏰ *Time:* ${apptTime}${appointment.tokenNumber ? `\n🔢 Token Number: *#${appointment.tokenNumber}*` : ''}\n` +
                `👨‍⚕️ *Doctor:* Dr. ${doctorName}\n` +
                `📍 *Location:* ${appointment.clinic.location || 'Clinic Facility'}\n` +
                (clinicContact ? `📞 *Questions / Rescheduling:* ${clinicContact}\n\n` : '\n') +
                `_We look forward to seeing you. Please remember to arrive 10 minutes early._`;
        }

        const res = await sendWhatsAppMessage(appointment.patient.phone, message, appointment.clinicId);

        // Record Audit Log (non-blocking)
        prisma.auditlog.create({
            data: {
                action: 'WhatsApp Reminder Sent',
                performedBy: 'AUTO_SCHEDULER',
                clinicId: appointment.clinicId,
                details: JSON.stringify({
                    appointmentId,
                    phone: appointment.patient.phone,
                    language: lang,
                    status: res.mode
                })
            }
        }).catch(err => console.error('[WHATSAPP REMINDER AUDIT] Error:', err));

        // Create internal notification
        prisma.notification.create({
            data: {
                clinicId: appointment.clinicId,
                department: 'reception',
                message: `WhatsApp reminder sent to ${patientName} (${appointment.patient.phone}) for appointment on ${formattedDate} at ${apptTime}`,
                status: 'unread'
            }
        }).catch(err => console.error('[WHATSAPP NOTIF] Error:', err));

        return { success: true, message, whatsappUrl: generateWhatsAppWebUrl(appointment.patient.phone, message) };
    } catch (err: any) {
        console.error('[WHATSAPP SERVICE] Reminder error:', err);
        return null;
    }
};
