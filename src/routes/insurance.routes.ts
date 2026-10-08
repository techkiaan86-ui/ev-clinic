import { Router } from 'express';
import { 
    getPatientCoverages, 
    createPatientCoverage, 
    updatePatientCoverage, 
    deletePatientCoverage,
    getInsuranceProviders,
    getClaims,
    getClaimsDashboardStats,
    getClaimById,
    createClaim,
    updateClaimStatus,
    addClaimDocument,
    deleteClaimDocument,
    validateClaim
} from '../controllers/insurance.controller.js';
import { protect } from '../middlewares/auth.js';

const router = Router();

// Coverage routes
router.get('/patients/:patientId/coverage', protect, getPatientCoverages);
router.post('/patients/:patientId/coverage', protect, createPatientCoverage);
router.put('/coverage/:id', protect, updatePatientCoverage);
router.delete('/coverage/:id', protect, deletePatientCoverage);

// Providers
router.get('/providers', protect, getInsuranceProviders);

// Claims routes
router.get('/claims', protect, getClaims);
router.get('/claims/stats', protect, getClaimsDashboardStats);
router.get('/claims/:id', protect, getClaimById);
router.post('/claims', protect, createClaim);
router.post('/claims/:id/status', protect, updateClaimStatus);
router.post('/claims/:id/documents', protect, addClaimDocument);
router.delete('/claims/:id/documents/:docId', protect, deleteClaimDocument);
router.get('/claims/:id/validate', protect, validateClaim);

export default router;
