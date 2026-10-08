import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.js';
import * as analyticsService from '../services/analytics.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getClinicAnalytics = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    if (!clinicId) {
        res.status(400).json({ success: false, message: 'Clinic context is required for analytics' });
        return;
    }

    const { range, startDate, endDate, groupBy } = req.query as any;

    const data = await analyticsService.getClinicDashboardAnalytics(clinicId, {
        range,
        startDate,
        endDate,
        groupBy
    });

    res.status(200).json({
        success: true,
        data
    });
});

export const getAccountingAnalytics = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    if (!clinicId) {
        res.status(400).json({ success: false, message: 'Clinic context is required for analytics' });
        return;
    }

    const { range, startDate, endDate, groupBy } = req.query as any;

    const data = await analyticsService.getAccountingDashboardAnalytics(clinicId, {
        range,
        startDate,
        endDate,
        groupBy
    });

    res.status(200).json({
        success: true,
        data
    });
});
