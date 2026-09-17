import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.js';
import * as billingService from '../services/billing.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getAccountingDashboardStats = asyncHandler(async (req: AuthRequest, res: Response) => {
    const stats = await billingService.getAccountingDashboardStats(req.clinicId!);
    res.status(200).json({ status: 'success', data: stats });
});

export const getInvoices = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { date, patientName, search } = req.query;
    const invoices = await billingService.getInvoices(req.clinicId!, {
        date: date as string,
        patientName: (patientName || search) as string
    });
    res.status(200).json({ status: 'success', data: invoices });
});

export const createInvoice = asyncHandler(async (req: AuthRequest, res: Response) => {
    const invoice = await billingService.createInvoice(req.clinicId!, req.body);
    res.status(201).json({ status: 'success', data: invoice });
});

export const updateInvoice = asyncHandler(async (req: AuthRequest, res: Response) => {
    const invoice = await billingService.updateInvoiceStatus(req.clinicId!, req.params.id as string, req.body.status, req.body.paymentMethod);
    res.status(200).json({ status: 'success', data: invoice });
});

export const getPendingItems = asyncHandler(async (req: AuthRequest, res: Response) => {
    const items = await billingService.getPendingBillingItems(req.clinicId!, Number(req.params.patientId));
    res.status(200).json({ status: 'success', data: items });
});

export const markItemOutside = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { type, id } = req.params;
    const result = await billingService.markItemOutside(req.clinicId!, Number(id), type as string);
    res.status(200).json({ status: 'success', data: result });
});

