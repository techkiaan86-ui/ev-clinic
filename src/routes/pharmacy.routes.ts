import { Router } from 'express';
import * as pharmacyController from '../controllers/pharmacy.controller.js';
import { protect, ensureClinicContext, requireModule } from '../middlewares/auth.js';

const router = Router();

router.use(protect);
router.use(ensureClinicContext);
router.use(requireModule('pharmacy'));

router.get('/inventory', pharmacyController.getInventory);
router.get('/inventory/low-stock', pharmacyController.getLowStock);
router.get('/inventory/:id', pharmacyController.getInventoryItem);
router.post('/inventory', pharmacyController.addInventory);
router.patch('/inventory/:id', pharmacyController.updateInventory);
router.delete('/inventory/:id', pharmacyController.deleteInventory);

// Batches
router.get('/inventory/:id/batches', pharmacyController.getBatches);
router.post('/inventory/:id/batches', pharmacyController.addBatch);
router.get('/batches', pharmacyController.getBatches);
router.patch('/batches/:batchId', pharmacyController.updateBatch);
router.delete('/batches/:batchId', pharmacyController.deleteBatch);

// Alerts & Configuration
router.get('/alerts', pharmacyController.getAlerts);
router.post('/alerts/:alertId/acknowledge', pharmacyController.acknowledgeAlert);
router.get('/alerts/settings', pharmacyController.getAlertSettings);
router.post('/alerts/settings', pharmacyController.saveAlertSettings);

// Purchase Orders / Reordering
router.get('/purchase-orders', pharmacyController.getPurchaseOrders);
router.post('/purchase-orders', pharmacyController.createPurchaseOrder);
router.patch('/purchase-orders/:id/status', pharmacyController.updatePurchaseOrderStatus);

router.get('/orders', pharmacyController.getOrders);
router.post('/orders/process', pharmacyController.processOrder);
router.get('/pos', pharmacyController.getPosSales);
router.post('/pos', pharmacyController.directSale);
router.patch('/pos/:id', pharmacyController.updatePosSale);
router.delete('/pos/:id', pharmacyController.deletePosSale);
router.get('/notifications', pharmacyController.getNotifications);
router.get('/reports', pharmacyController.getReports);

export default router;
