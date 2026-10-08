import { Router } from 'express';
import { getStats } from '../controllers/dashboard.controller.js';
import { getClinicAnalytics, getAccountingAnalytics } from '../controllers/analytics.controller.js';
import { protect } from '../middlewares/auth.js';

const router = Router();

router.get('/stats', protect, getStats);
router.get('/analytics/clinic', protect, getClinicAnalytics);
router.get('/analytics/accounting', protect, getAccountingAnalytics);

export default router;

