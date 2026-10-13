import { Router } from 'express';
import { getMenu } from '../controllers/menu.controller.js';
import { protect, ensureClinicContext } from '../middlewares/auth.js';

const router = Router();

router.use(protect, ensureClinicContext);
router.get('/:role', getMenu);
router.get('/', getMenu);

export default router;
