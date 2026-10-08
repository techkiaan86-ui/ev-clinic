import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.js';
import * as insuranceService from '../services/insurance.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ── Patient Coverages ────────────────────────────────────────────────────────
export const getPatientCoverages = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    const patientId = Number(req.params.patientId);

    if (!clinicId) {
        res.status(400).json({ success: false, message: 'Clinic context is required' });
        return;
    }

    const coverages = await insuranceService.getPatientCoverages(clinicId, patientId);
    res.status(200).json({ success: true, data: coverages });
});

export const createPatientCoverage = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    if (!clinicId) {
        res.status(400).json({ success: false, message: 'Clinic context is required' });
        return;
    }

    const userName = (req.user as any)?.name || req.user?.email || 'Staff';
    const coverage = await insuranceService.createPatientCoverage(clinicId, req.body, userName);
    res.status(201).json({ success: true, data: coverage });
});

export const updatePatientCoverage = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    const id = String(req.params.id);

    const updated = await insuranceService.updatePatientCoverage(clinicId, id, req.body);
    res.status(200).json({ success: true, data: updated });
});

export const deletePatientCoverage = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    const id = String(req.params.id);

    const result = await insuranceService.deletePatientCoverage(clinicId, id);
    res.status(200).json({ success: true, data: result });
});

// ── Providers ─────────────────────────────────────────────────────────────────
export const getInsuranceProviders = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    const providers = await insuranceService.getInsuranceProviders(clinicId);
    res.status(200).json({ success: true, data: providers });
});

// ── Claims ───────────────────────────────────────────────────────────────────
export const getClaims = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    if (!clinicId) {
        res.status(400).json({ success: false, message: 'Clinic context is required' });
        return;
    }

    const claims = await insuranceService.getClaims(clinicId, req.query as any);
    res.status(200).json({ success: true, data: claims });
});

export const getClaimsDashboardStats = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    if (!clinicId) {
        res.status(400).json({ success: false, message: 'Clinic context is required' });
        return;
    }

    const stats = await insuranceService.getClaimsDashboardStats(clinicId);
    res.status(200).json({ success: true, data: stats });
});

export const getClaimById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    const id = String(req.params.id);

    const claim = await insuranceService.getClaimById(clinicId, id);
    res.status(200).json({ success: true, data: claim });
});

export const createClaim = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    if (!clinicId) {
        res.status(400).json({ success: false, message: 'Clinic context is required' });
        return;
    }

    const claim = await insuranceService.createClaim(clinicId, req.body, req.user);
    res.status(201).json({ success: true, data: claim });
});

export const updateClaimStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    const id = String(req.params.id);
    const { status, notes, approvedAmount, rejectedAmount } = req.body;

    const updated = await insuranceService.updateClaimStatus(clinicId, id, status, notes, approvedAmount, rejectedAmount, req.user);
    res.status(200).json({ success: true, data: updated });
});

export const addClaimDocument = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    const id = String(req.params.id);

    const updated = await insuranceService.addClaimDocument(clinicId, id, req.body, req.user);
    res.status(200).json({ success: true, data: updated });
});

export const deleteClaimDocument = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    const id = String(req.params.id);
    const docId = String(req.params.docId);

    const updated = await insuranceService.deleteClaimDocument(clinicId, id, docId);
    res.status(200).json({ success: true, data: updated });
});

export const validateClaim = asyncHandler(async (req: AuthRequest, res: Response) => {
    const clinicId = req.clinicId || (req.user as any)?.clinicId;
    const id = String(req.params.id);

    const claim = await insuranceService.getClaimById(clinicId, id);
    const validation = insuranceService.validateClaimSubmission(claim);
    res.status(200).json({ success: true, data: validation });
});
