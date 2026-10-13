import { Router } from 'express';
import { getStats } from '../controllers/dashboard.controller.js';
import { getClinicAnalytics, getAccountingAnalytics } from '../controllers/analytics.controller.js';
import { protect, ensureClinicContext } from '../middlewares/auth.js';

const router = Router();

router.get('/stats', protect, ensureClinicContext, getStats);
router.get('/analytics/clinic', protect, ensureClinicContext, getClinicAnalytics);
router.get('/analytics/accounting', protect, ensureClinicContext, getAccountingAnalytics);

export default router;

