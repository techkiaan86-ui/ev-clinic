import { Router } from 'express';
import * as formController from '../controllers/forms.controller.js';
import { protect, restrictTo, ensureClinicContext } from '../middlewares/auth.js';

const router = Router();

// Base protection
router.use(protect, ensureClinicContext);

// Templates
router.get('/templates', restrictTo('ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'STAFF', 'SUPER_ADMIN'), formController.getTemplates);
router.get('/templates/:id', restrictTo('ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'STAFF', 'SUPER_ADMIN'), formController.getTemplateById);
router.post('/templates', restrictTo('ADMIN', 'SUPER_ADMIN'), formController.createTemplate);
router.patch('/templates/:id', restrictTo('ADMIN', 'SUPER_ADMIN'), formController.updateTemplate);
router.delete('/templates/:id', restrictTo('ADMIN', 'SUPER_ADMIN'), formController.deleteTemplate);

// Form Responses (Doctors / Staff / Admins)
router.get('/responses', restrictTo('DOCTOR', 'ADMIN', 'NURSE', 'RECEPTIONIST', 'STAFF', 'SUPER_ADMIN'), formController.getAllResponses);
router.post('/responses', restrictTo('DOCTOR', 'ADMIN', 'NURSE', 'SUPER_ADMIN'), formController.submitResponse);
router.get('/responses/:id', restrictTo('DOCTOR', 'ADMIN', 'NURSE', 'RECEPTIONIST', 'STAFF', 'SUPER_ADMIN'), formController.getResponseById);
router.get('/patient/:patientId/responses', restrictTo('DOCTOR', 'ADMIN', 'NURSE', 'RECEPTIONIST', 'STAFF', 'SUPER_ADMIN'), formController.getPatientResponses);

export default router;
