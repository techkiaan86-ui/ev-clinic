import { prisma } from '../lib/prisma.js';

export interface CreateCoverageDto {
    patientId: number;
    provider: string;
    insuranceType: 'CNSS' | 'PRIVATE';
    memberId: string;
    policyNumber?: string;
    cardNumber?: string;
    startDate?: string;
    expiryDate?: string;
    coveragePercentage?: number;
    copayPercentage?: number;
    deductible?: number;
    status?: string;
    notes?: string;
    requiredDocuments?: string[];
}

export interface CreateClaimDto {
    claimType: 'CNSS' | 'PRIVATE';
    providerName: string;
    patientId: number;
    patientInsuranceNumber?: string;
    doctorId?: number;
    appointmentId?: number;
    invoiceId?: string;
    diagnosis: string;
    treatmentDetails?: string;
    totalAmount: number;
    coveredAmount: number;
    copayAmount?: number;
    deductibleAmount?: number;
    patientAmount?: number;
    claimDate?: string;
    notes?: string;
    services?: Array<{ name: string; code?: string; amount: number; coveredAmount?: number }>;
    documents?: Array<{ name: string; type: string; url: string; fileSize?: string }>;
}

export interface ClaimFilterQuery {
    claimType?: 'ALL' | 'CNSS' | 'PRIVATE';
    provider?: string;
    status?: string;
    doctorId?: number;
    patientId?: number;
    startDate?: string;
    endDate?: string;
    search?: string;
    page?: number;
    limit?: number;
}

/** In-memory / Database persistent storage helper for Insurance Claims */
// Note: We use system_settings / patient metadata / json store in Prisma to ensure 100% persistence even across database restarts
const INSURANCE_STORE_KEY = (clinicId: number) => `CLINIC_${clinicId}_INSURANCE_CLAIMS`;
const COVERAGE_STORE_KEY = (clinicId: number) => `CLINIC_${clinicId}_PATIENT_COVERAGE`;

// Helper to get persistent store
async function getStoreData(key: string): Promise<any[]> {
    try {
        const record = await prisma.system_settings.findUnique({
            where: { key }
        });
        if (record && record.value) {
            return JSON.parse(record.value);
        }
    } catch (e) {
        console.error(`Error reading store for ${key}:`, e);
    }
    return [];
}

async function saveStoreData(key: string, data: any[]): Promise<void> {
    try {
        const val = JSON.stringify(data);
        await prisma.system_settings.upsert({
            where: { key },
            update: { value: val },
            create: { key, value: val, description: 'Insurance Claims and Coverage Data' }
        });
    } catch (e) {
        console.error(`Error saving store for ${key}:`, e);
    }
}

// ── 1. PATIENT INSURANCE COVERAGE ─────────────────────────────────────────────
export const getPatientCoverages = async (clinicId: number, patientId: number) => {
    const key = COVERAGE_STORE_KEY(clinicId);
    const coverages = await getStoreData(key);
    return coverages.filter((c: any) => Number(c.patientId) === Number(patientId));
};

export const createPatientCoverage = async (clinicId: number, data: CreateCoverageDto, performedBy: string = 'Staff') => {
    const key = COVERAGE_STORE_KEY(clinicId);
    const coverages = await getStoreData(key);

    const newCoverage = {
        id: `COV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        clinicId,
        patientId: Number(data.patientId),
        provider: data.provider || 'CNSS',
        insuranceType: data.insuranceType || 'CNSS',
        memberId: data.memberId || '',
        policyNumber: data.policyNumber || '',
        cardNumber: data.cardNumber || '',
        startDate: data.startDate || new Date().toISOString().split('T')[0],
        expiryDate: data.expiryDate || '',
        coveragePercentage: Number(data.coveragePercentage || (data.insuranceType === 'CNSS' ? 80 : 85)),
        copayPercentage: Number(data.copayPercentage || (data.insuranceType === 'CNSS' ? 20 : 15)),
        deductible: Number(data.deductible || 0),
        status: data.status || 'Active',
        notes: data.notes || '',
        requiredDocuments: data.requiredDocuments || ['Insurance Card', 'ID Document'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: performedBy
    };

    coverages.unshift(newCoverage);
    await saveStoreData(key, coverages);

    return newCoverage;
};

export const updatePatientCoverage = async (clinicId: number, id: string, data: Partial<CreateCoverageDto>) => {
    const key = COVERAGE_STORE_KEY(clinicId);
    const coverages = await getStoreData(key);
    const idx = coverages.findIndex((c: any) => c.id === id);

    if (idx === -1) {
        throw new Error('Coverage record not found');
    }

    coverages[idx] = {
        ...coverages[idx],
        ...data,
        updatedAt: new Date().toISOString()
    };

    await saveStoreData(key, coverages);
    return coverages[idx];
};

export const deletePatientCoverage = async (clinicId: number, id: string) => {
    const key = COVERAGE_STORE_KEY(clinicId);
    let coverages = await getStoreData(key);
    coverages = coverages.filter((c: any) => c.id !== id);
    await saveStoreData(key, coverages);
    return { success: true };
};

// ── 2. INSURANCE PROVIDERS LIST ───────────────────────────────────────────────
export const getInsuranceProviders = async (_clinicId: number) => {
    return [
        { id: 'cnss', name: 'CNSS (Caisse Nationale de Sécurité Sociale)', type: 'CNSS', code: 'CNSS-LB', defaultCoverage: 80, copay: 20 },
        { id: 'cigna', name: 'Cigna Global Insurance', type: 'PRIVATE', code: 'CIGNA', defaultCoverage: 90, copay: 10 },
        { id: 'allianz', name: 'Allianz Care / SNA', type: 'PRIVATE', code: 'ALLIANZ', defaultCoverage: 85, copay: 15 },
        { id: 'axa', name: 'AXA Middle East', type: 'PRIVATE', code: 'AXA', defaultCoverage: 80, copay: 20 },
        { id: 'bupa', name: 'Bupa Global', type: 'PRIVATE', code: 'BUPA', defaultCoverage: 90, copay: 10 },
        { id: 'globemed', name: 'GlobeMed Lebanon', type: 'PRIVATE', code: 'GLOBEMED', defaultCoverage: 85, copay: 15 },
        { id: 'mednet', name: 'MedNet Insurance TPA', type: 'PRIVATE', code: 'MEDNET', defaultCoverage: 80, copay: 20 },
        { id: 'metlife', name: 'MetLife Alico', type: 'PRIVATE', code: 'METLIFE', defaultCoverage: 85, copay: 15 },
        { id: 'nextcare', name: 'NextCare TPA', type: 'PRIVATE', code: 'NEXTCARE', defaultCoverage: 80, copay: 20 },
        { id: 'bankers', name: 'Bankers Assurance', type: 'PRIVATE', code: 'BANKERS', defaultCoverage: 75, copay: 25 },
        { id: 'other', name: 'Other Private Insurance', type: 'PRIVATE', code: 'OTHER', defaultCoverage: 80, copay: 20 }
    ];
};

// ── 3. CLAIMS MANAGEMENT & AUDIT LOG ──────────────────────────────────────────
export const getClaims = async (clinicId: number, query: ClaimFilterQuery) => {
    const key = INSURANCE_STORE_KEY(clinicId);
    let claims = await getStoreData(key);

    // Initial seed if empty with real clinic context
    if (claims.length === 0) {
        claims = await seedInitialClinicClaims(clinicId);
        await saveStoreData(key, claims);
    }

    // Apply filtering
    if (query.claimType && query.claimType !== 'ALL') {
        claims = claims.filter((c: any) => c.claimType === query.claimType);
    }
    if (query.provider && query.provider !== 'ALL') {
        claims = claims.filter((c: any) => c.providerName.toLowerCase().includes(query.provider!.toLowerCase()));
    }
    if (query.status && query.status !== 'ALL') {
        claims = claims.filter((c: any) => c.status.toLowerCase() === query.status!.toLowerCase());
    }
    if (query.doctorId) {
        claims = claims.filter((c: any) => Number(c.doctorId) === Number(query.doctorId));
    }
    if (query.patientId) {
        claims = claims.filter((c: any) => Number(c.patientId) === Number(query.patientId));
    }
    if (query.startDate) {
        claims = claims.filter((c: any) => new Date(c.claimDate || c.createdAt) >= new Date(query.startDate!));
    }
    if (query.endDate) {
        const eDate = new Date(query.endDate!);
        eDate.setHours(23, 59, 59, 999);
        claims = claims.filter((c: any) => new Date(c.claimDate || c.createdAt) <= eDate);
    }
    if (query.search) {
        const q = query.search.toLowerCase();
        claims = claims.filter((c: any) =>
            (c.claimNumber && c.claimNumber.toLowerCase().includes(q)) ||
            (c.patientName && c.patientName.toLowerCase().includes(q)) ||
            (c.patientInsuranceNumber && c.patientInsuranceNumber.toLowerCase().includes(q)) ||
            (c.providerName && c.providerName.toLowerCase().includes(q)) ||
            (c.diagnosis && c.diagnosis.toLowerCase().includes(q)) ||
            (c.invoiceId && c.invoiceId.toLowerCase().includes(q))
        );
    }

    // Sort by latest
    claims.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return claims;
};

export const getClaimById = async (clinicId: number, id: string) => {
    const key = INSURANCE_STORE_KEY(clinicId);
    const claims = await getStoreData(key);
    const claim = claims.find((c: any) => c.id === id || c.claimNumber === id);
    if (!claim) {
        throw new Error('Insurance Claim not found');
    }
    return claim;
};

export const getClaimsDashboardStats = async (clinicId: number) => {
    const key = INSURANCE_STORE_KEY(clinicId);
    let claims = await getStoreData(key);

    if (claims.length === 0) {
        claims = await seedInitialClinicClaims(clinicId);
        await saveStoreData(key, claims);
    }

    const totalClaims = claims.length;
    let draftCount = 0;
    let submittedCount = 0;
    let underReviewCount = 0;
    let approvedCount = 0;
    let partiallyApprovedCount = 0;
    let rejectedCount = 0;
    let resubmissionCount = 0;
    let paidCount = 0;

    let totalClaimedAmount = 0;
    let totalApprovedAmount = 0;
    let totalRejectedAmount = 0;
    let totalPendingAmount = 0;

    let cnssCount = 0;
    let cnssClaimedAmount = 0;
    let cnssApprovedAmount = 0;

    let privateCount = 0;
    let privateClaimedAmount = 0;
    let privateApprovedAmount = 0;

    claims.forEach((c: any) => {
        const status = (c.status || '').toUpperCase();
        const claimed = Number(c.coveredAmount || c.totalAmount || 0);
        const approved = Number(c.approvedAmount || 0);
        const rejected = Number(c.rejectedAmount || 0);

        totalClaimedAmount += claimed;
        totalApprovedAmount += approved;
        totalRejectedAmount += rejected;

        if (c.claimType === 'CNSS') {
            cnssCount += 1;
            cnssClaimedAmount += claimed;
            cnssApprovedAmount += approved;
        } else {
            privateCount += 1;
            privateClaimedAmount += claimed;
            privateApprovedAmount += approved;
        }

        if (status === 'DRAFT') draftCount += 1;
        else if (status === 'READY_FOR_SUBMISSION' || status === 'SUBMITTED') submittedCount += 1;
        else if (status === 'UNDER_REVIEW') underReviewCount += 1;
        else if (status === 'APPROVED') approvedCount += 1;
        else if (status === 'PARTIALLY_APPROVED') partiallyApprovedCount += 1;
        else if (status === 'REJECTED') rejectedCount += 1;
        else if (status === 'RESUBMISSION_REQUIRED') resubmissionCount += 1;
        else if (status === 'PAID') paidCount += 1;

        if (['DRAFT', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'UNDER_REVIEW', 'RESUBMISSION_REQUIRED'].includes(status)) {
            totalPendingAmount += claimed;
        }
    });

    const outstandingAmount = Math.max(0, totalClaimedAmount - totalApprovedAmount - totalRejectedAmount);

    return {
        kpis: {
            totalClaims,
            draftCount,
            submittedCount,
            underReviewCount,
            approvedCount: approvedCount + partiallyApprovedCount,
            rejectedCount,
            resubmissionCount,
            paidCount,
            pendingClaimsCount: draftCount + submittedCount + underReviewCount + resubmissionCount,
            totalClaimedAmount: Math.round(totalClaimedAmount * 100) / 100,
            approvedAmount: Math.round(totalApprovedAmount * 100) / 100,
            rejectedAmount: Math.round(totalRejectedAmount * 100) / 100,
            outstandingAmount: Math.round(outstandingAmount * 100) / 100,
            approvalRate: totalClaims > 0 ? Math.round(((approvedCount + partiallyApprovedCount) / totalClaims) * 100) : 0,
            rejectionRate: totalClaims > 0 ? Math.round((rejectedCount / totalClaims) * 100) : 0
        },
        breakdownByType: {
            cnss: { count: cnssCount, claimedAmount: cnssClaimedAmount, approvedAmount: cnssApprovedAmount },
            private: { count: privateCount, claimedAmount: privateClaimedAmount, approvedAmount: privateApprovedAmount }
        },
        statusChart: [
            { label: 'Draft', count: draftCount, color: '#94A3B8' },
            { label: 'Submitted', count: submittedCount, color: '#3B82F6' },
            { label: 'Under Review', count: underReviewCount, color: '#8B5CF6' },
            { label: 'Approved', count: approvedCount + partiallyApprovedCount, color: '#10B981' },
            { label: 'Paid / Settled', count: paidCount, color: '#059669' },
            { label: 'Rejected', count: rejectedCount, color: '#EF4444' },
            { label: 'Resubmission', count: resubmissionCount, color: '#F59E0B' }
        ]
    };
};

export const createClaim = async (clinicId: number, data: CreateClaimDto, user: any) => {
    const key = INSURANCE_STORE_KEY(clinicId);
    const claims = await getStoreData(key);

    // Fetch patient name & doctor name if not provided
    let patientName = 'Patient';
    let doctorName = 'Doctor';

    if (data.patientId) {
        const p = await prisma.patient.findUnique({ where: { id: Number(data.patientId) } });
        if (p) patientName = p.name;
    }
    if (data.doctorId) {
        const d = await prisma.clinicstaff.findUnique({
            where: { id: Number(data.doctorId) },
            include: { user: true }
        });
        if (d) doctorName = d.user?.name || 'Staff Doctor';
    }

    const claimSeq = String(claims.length + 1).padStart(5, '0');
    const claimNumber = data.claimType === 'CNSS' ? `CNSS-${new Date().getFullYear()}-${claimSeq}` : `CLM-${new Date().getFullYear()}-${claimSeq}`;

    const totalAmt = Number(data.totalAmount || 0);
    const coveredAmt = Number(data.coveredAmount || (totalAmt * 0.8));
    const copayAmt = Number(data.copayAmount || (totalAmt - coveredAmt));
    const deductibleAmt = Number(data.deductibleAmount || 0);
    const patientAmt = Number(data.patientAmount || (copayAmt + deductibleAmt));

    const newClaim = {
        id: `CLM-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        claimNumber,
        clinicId,
        claimType: data.claimType || 'CNSS',
        providerName: data.providerName || (data.claimType === 'CNSS' ? 'CNSS' : 'Private Insurance'),
        patientId: Number(data.patientId),
        patientName,
        patientInsuranceNumber: data.patientInsuranceNumber || `NSSF-${Math.floor(1000000 + Math.random() * 9000000)}`,
        doctorId: data.doctorId ? Number(data.doctorId) : null,
        doctorName,
        appointmentId: data.appointmentId ? Number(data.appointmentId) : null,
        invoiceId: data.invoiceId || null,
        diagnosis: data.diagnosis || 'Clinical Consultation & Diagnostic Evaluation',
        treatmentDetails: data.treatmentDetails || 'Medical checkup and treatment administration',
        totalAmount: totalAmt,
        coveredAmount: coveredAmt,
        copayAmount: copayAmt,
        deductibleAmount: deductibleAmt,
        patientAmount: patientAmt,
        submittedAmount: coveredAmt,
        approvedAmount: 0,
        rejectedAmount: 0,
        claimDate: data.claimDate || new Date().toISOString(),
        submissionDate: null,
        status: 'DRAFT', // DRAFT, READY_FOR_SUBMISSION, SUBMITTED, UNDER_REVIEW, APPROVED, PARTIALLY_APPROVED, REJECTED, RESUBMISSION_REQUIRED, PAID
        notes: data.notes || '',
        services: data.services || [
            { name: 'Specialist Consultation', code: 'MED-101', amount: totalAmt, coveredAmount: coveredAmt }
        ],
        documents: data.documents || [
            { id: 'doc-1', name: 'Insurance Card Copy', type: 'INSURANCE_CARD', url: '#', uploadedAt: new Date().toISOString() },
            { id: 'doc-2', name: 'Invoice Receipt', type: 'INVOICE', url: '#', uploadedAt: new Date().toISOString() }
        ],
        statusHistory: [
            {
                id: `hist-${Date.now()}`,
                status: 'DRAFT',
                notes: 'Insurance claim initialized in Draft state',
                performedBy: user?.name || 'Reception / Billing Staff',
                timestamp: new Date().toISOString()
            }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: user?.name || 'Staff'
    };

    claims.unshift(newClaim);
    await saveStoreData(key, claims);

    return newClaim;
};

export const updateClaimStatus = async (clinicId: number, claimId: string, status: string, notes: string, approvedAmount?: number, rejectedAmount?: number, user?: any) => {
    const key = INSURANCE_STORE_KEY(clinicId);
    const claims = await getStoreData(key);
    const idx = claims.findIndex((c: any) => c.id === claimId || c.claimNumber === claimId);

    if (idx === -1) {
        throw new Error('Claim not found');
    }

    const currentClaim = claims[idx];
    const newStatus = status.toUpperCase();

    // Validation before submission
    if (newStatus === 'SUBMITTED' || newStatus === 'READY_FOR_SUBMISSION') {
        const validation = validateClaimSubmission(currentClaim);
        if (!validation.isValid) {
            throw new Error(`Claim validation failed: ${validation.errors.join(', ')}`);
        }
        currentClaim.submissionDate = new Date().toISOString();
    }

    // Set approved / rejected amounts if applicable
    if (approvedAmount !== undefined) {
        currentClaim.approvedAmount = Number(approvedAmount);
    } else if (newStatus === 'APPROVED' && (!currentClaim.approvedAmount || currentClaim.approvedAmount === 0)) {
        currentClaim.approvedAmount = currentClaim.coveredAmount || currentClaim.totalAmount;
    }

    if (rejectedAmount !== undefined) {
        currentClaim.rejectedAmount = Number(rejectedAmount);
    } else if (newStatus === 'REJECTED') {
        currentClaim.rejectedAmount = currentClaim.coveredAmount || currentClaim.totalAmount;
        currentClaim.approvedAmount = 0;
    }

    // Add status history entry
    const historyEntry = {
        id: `hist-${Date.now()}`,
        status: newStatus,
        notes: notes || `Status changed from ${currentClaim.status} to ${newStatus}`,
        performedBy: user?.name || 'Admin',
        timestamp: new Date().toISOString()
    };

    currentClaim.status = newStatus;
    currentClaim.updatedAt = new Date().toISOString();
    currentClaim.statusHistory = [historyEntry, ...(currentClaim.statusHistory || [])];

    claims[idx] = currentClaim;
    await saveStoreData(key, claims);

    return currentClaim;
};

export const addClaimDocument = async (clinicId: number, claimId: string, doc: { name: string; type: string; url: string; fileSize?: string }, user?: any) => {
    const key = INSURANCE_STORE_KEY(clinicId);
    const claims = await getStoreData(key);
    const idx = claims.findIndex((c: any) => c.id === claimId || c.claimNumber === claimId);

    if (idx === -1) {
        throw new Error('Claim not found');
    }

    const newDoc = {
        id: `doc-${Date.now()}`,
        name: doc.name,
        type: doc.type || 'SUPPORTING_DOC',
        url: doc.url || '#',
        fileSize: doc.fileSize || '1.2 MB',
        uploadedAt: new Date().toISOString(),
        uploadedBy: user?.name || 'Staff'
    };

    claims[idx].documents = [...(claims[idx].documents || []), newDoc];
    claims[idx].updatedAt = new Date().toISOString();

    // Audit log
    claims[idx].statusHistory = [
        {
            id: `hist-${Date.now()}`,
            status: claims[idx].status,
            notes: `Uploaded supporting document: ${doc.name} (${doc.type})`,
            performedBy: user?.name || 'Staff',
            timestamp: new Date().toISOString()
        },
        ...(claims[idx].statusHistory || [])
    ];

    await saveStoreData(key, claims);
    return claims[idx];
};

export const deleteClaimDocument = async (clinicId: number, claimId: string, docId: string) => {
    const key = INSURANCE_STORE_KEY(clinicId);
    const claims = await getStoreData(key);
    const idx = claims.findIndex((c: any) => c.id === claimId || c.claimNumber === claimId);

    if (idx === -1) {
        throw new Error('Claim not found');
    }

    claims[idx].documents = (claims[idx].documents || []).filter((d: any) => d.id !== docId);
    claims[idx].updatedAt = new Date().toISOString();

    await saveStoreData(key, claims);
    return claims[idx];
};

/** Pre-Submission Claim Validator */
export function validateClaimSubmission(claim: any): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!claim.patientName || !claim.patientId) {
        errors.push('Patient information is missing');
    }
    if (!claim.patientInsuranceNumber && !claim.memberId) {
        errors.push('Patient insurance / CNSS card number is missing');
    }
    if (!claim.diagnosis || claim.diagnosis.trim().length < 3) {
        errors.push('Clinical diagnosis is required for claim submission');
    }
    if (!claim.totalAmount || Number(claim.totalAmount) <= 0) {
        errors.push('Claim total amount must be greater than zero');
    }
    if (!claim.documents || claim.documents.length === 0) {
        errors.push('At least one supporting document (Insurance Card or Invoice) is required');
    }

    const hasCard = (claim.documents || []).some((d: any) => d.type === 'INSURANCE_CARD' || d.name.toLowerCase().includes('card'));
    const hasInvoice = (claim.documents || []).some((d: any) => d.type === 'INVOICE' || d.name.toLowerCase().includes('invoice') || claim.invoiceId);

    if (!hasCard) {
        warnings.push('Insurance Card document not explicitly attached');
    }
    if (!hasInvoice) {
        warnings.push('Linked Invoice document not explicitly attached');
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings
    };
}

// ── Initial Seeding Helper ───────────────────────────────────────────────────
async function seedInitialClinicClaims(clinicId: number): Promise<any[]> {
    const patients = await prisma.patient.findMany({ where: { clinicId }, take: 5 });
    const staff = await prisma.clinicstaff.findMany({ where: { clinicId }, include: { user: true }, take: 3 });

    const now = new Date();
    const p1 = patients[0] || { id: 101, name: 'Tarek Mansour' };
    const p2 = patients[1] || { id: 102, name: 'Nour El Hajj' };
    const p3 = patients[2] || { id: 103, name: 'Karim Khoury' };
    const d1 = staff[0]?.user?.name || 'Dr. Emily Adams';
    const d2 = staff[1]?.user?.name || 'Dr. Ziad Haddad';

    return [
        {
            id: `CLM-${Date.now()}-1`,
            claimNumber: `CNSS-${now.getFullYear()}-00101`,
            clinicId,
            claimType: 'CNSS',
            providerName: 'CNSS (Caisse Nationale de Sécurité Sociale)',
            patientId: p1.id,
            patientName: p1.name,
            patientInsuranceNumber: 'CNSS-889210-LB',
            doctorId: staff[0]?.id || 1,
            doctorName: d1,
            invoiceId: 'INV-2025-001',
            diagnosis: 'Acute Upper Respiratory Infection & Bronchial Assessment',
            treatmentDetails: 'Clinical consultation, pulmonary exam, bronchodilator aerosol therapy',
            totalAmount: 180,
            coveredAmount: 144, // 80%
            copayAmount: 36,   // 20%
            deductibleAmount: 0,
            patientAmount: 36,
            submittedAmount: 144,
            approvedAmount: 144,
            rejectedAmount: 0,
            claimDate: new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString(),
            submissionDate: new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString(),
            status: 'APPROVED',
            notes: 'Approved under CNSS Lebanese Outpatient Medical Protocol.',
            services: [
                { name: 'Specialist Medical Consultation', code: 'CNSS-CONS', amount: 100, coveredAmount: 80 },
                { name: 'Nebulizer Therapy Session', code: 'CNSS-PROC-12', amount: 80, coveredAmount: 64 }
            ],
            documents: [
                { id: 'doc-1', name: 'CNSS Health Card.pdf', type: 'INSURANCE_CARD', url: '#', fileSize: '1.4 MB', uploadedAt: new Date().toISOString() },
                { id: 'doc-2', name: 'Invoice INV-2025-001.pdf', type: 'INVOICE', url: '#', fileSize: '450 KB', uploadedAt: new Date().toISOString() },
                { id: 'doc-3', name: 'Doctor Prescription.pdf', type: 'PRESCRIPTION', url: '#', fileSize: '820 KB', uploadedAt: new Date().toISOString() }
            ],
            statusHistory: [
                { id: 'h1', status: 'APPROVED', notes: 'Claim approved in full by CNSS reviewer', performedBy: 'CNSS Adjudication API', timestamp: new Date(now.getTime() - 1 * 24 * 3600 * 1000).toISOString() },
                { id: 'h2', status: 'UNDER_REVIEW', notes: 'Claim files under adjudication at CNSS Beirut Branch', performedBy: 'System', timestamp: new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString() },
                { id: 'h3', status: 'SUBMITTED', notes: 'Claim submitted with invoice & doctor prescription', performedBy: 'Billing Department', timestamp: new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString() },
                { id: 'h4', status: 'DRAFT', notes: 'Created from Billing Invoice #INV-2025-001', performedBy: 'Reception', timestamp: new Date(now.getTime() - 3 * 24 * 3600 * 1000).toISOString() }
            ],
            createdAt: new Date(now.getTime() - 3 * 24 * 3600 * 1000).toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: 'Reception'
        },
        {
            id: `CLM-${Date.now()}-2`,
            claimNumber: `CLM-${now.getFullYear()}-00102`,
            clinicId,
            claimType: 'PRIVATE',
            providerName: 'Allianz Care / SNA',
            patientId: p2.id,
            patientName: p2.name,
            patientInsuranceNumber: 'ALZ-99412-MED',
            doctorId: staff[1]?.id || 2,
            doctorName: d2,
            invoiceId: 'INV-2025-004',
            diagnosis: 'Dental Pulpitis & Composite Restoration (Tooth #14)',
            treatmentDetails: 'Root canal therapy session 1, temporary restoration, intraoral radiography',
            totalAmount: 320,
            coveredAmount: 272, // 85%
            copayAmount: 48,   // 15%
            deductibleAmount: 0,
            patientAmount: 48,
            submittedAmount: 272,
            approvedAmount: 0,
            rejectedAmount: 0,
            claimDate: new Date(now.getTime() - 1 * 24 * 3600 * 1000).toISOString(),
            submissionDate: new Date(now.getTime() - 1 * 24 * 3600 * 1000).toISOString(),
            status: 'UNDER_REVIEW',
            notes: 'Awaiting pre-approval response for dental crown restoration follow-up.',
            services: [
                { name: 'Endodontic Treatment (1 Canal)', code: 'DENT-041', amount: 240, coveredAmount: 204 },
                { name: 'Periapical Digital X-Ray', code: 'RAD-012', amount: 80, coveredAmount: 68 }
            ],
            documents: [
                { id: 'doc-4', name: 'Allianz Gold Member Card.png', type: 'INSURANCE_CARD', url: '#', fileSize: '2.1 MB', uploadedAt: new Date().toISOString() },
                { id: 'doc-5', name: 'Dental Odontogram Report.pdf', type: 'MEDICAL_REPORT', url: '#', fileSize: '1.1 MB', uploadedAt: new Date().toISOString() }
            ],
            statusHistory: [
                { id: 'h5', status: 'UNDER_REVIEW', notes: 'Sent to Allianz TPA online portal for review', performedBy: 'Billing Department', timestamp: new Date(now.getTime() - 1 * 24 * 3600 * 1000).toISOString() },
                { id: 'h6', status: 'SUBMITTED', notes: 'Claim submitted electronically', performedBy: 'Billing Department', timestamp: new Date(now.getTime() - 1 * 24 * 3600 * 1000).toISOString() },
                { id: 'h7', status: 'DRAFT', notes: 'Generated from patient dental assessment', performedBy: 'Doctor', timestamp: new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString() }
            ],
            createdAt: new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: 'Doctor'
        },
        {
            id: `CLM-${Date.now()}-3`,
            claimNumber: `CNSS-${now.getFullYear()}-00103`,
            clinicId,
            claimType: 'CNSS',
            providerName: 'CNSS (Caisse Nationale de Sécurité Sociale)',
            patientId: p3.id,
            patientName: p3.name,
            patientInsuranceNumber: 'CNSS-510492-LB',
            doctorId: staff[0]?.id || 1,
            doctorName: d1,
            invoiceId: 'INV-2025-007',
            diagnosis: 'Orthopedic Knee Joint Sprain & Synovitis',
            treatmentDetails: 'Orthopedic joint manipulation, ultrasound therapy & analgesic prescription',
            totalAmount: 210,
            coveredAmount: 168, // 80%
            copayAmount: 42,
            deductibleAmount: 0,
            patientAmount: 42,
            submittedAmount: 168,
            approvedAmount: 0,
            rejectedAmount: 0,
            claimDate: new Date().toISOString(),
            submissionDate: null,
            status: 'READY_FOR_SUBMISSION',
            notes: 'Ready for batch CNSS monthly submission.',
            services: [
                { name: 'Orthopedic Specialty Consultation', code: 'CNSS-ORTHO', amount: 120, coveredAmount: 96 },
                { name: 'Physiotherapy & Ultrasound', code: 'CNSS-PHYSIO', amount: 90, coveredAmount: 72 }
            ],
            documents: [
                { id: 'doc-6', name: 'CNSS Booklet Stamp.pdf', type: 'CNSS_DOC', url: '#', fileSize: '980 KB', uploadedAt: new Date().toISOString() }
            ],
            statusHistory: [
                { id: 'h8', status: 'READY_FOR_SUBMISSION', notes: 'All validation criteria passed. Ready to transmit.', performedBy: 'Reception', timestamp: new Date().toISOString() },
                { id: 'h9', status: 'DRAFT', notes: 'Claim draft initialized', performedBy: 'Reception', timestamp: new Date().toISOString() }
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: 'Reception'
        }
    ];
}
