import { Request, Response, NextFunction } from 'express';
import * as pharmacyService from '../services/pharmacy.service.js';

export const getInventory = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const inventory = await pharmacyService.getInventory(clinicId);
        res.json({ status: 'success', data: inventory });
    } catch (error) {
        next(error);
    }
};

export const getLowStock = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const threshold = req.query.threshold ? Number(req.query.threshold) : 10;
        const items = await pharmacyService.getLowStockInventory(clinicId, threshold);
        res.json({ status: 'success', data: items });
    } catch (error) {
        next(error);
    }
};

export const addInventory = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const item = await pharmacyService.addInventory(clinicId, req.body);
        res.status(201).json({ status: 'success', data: item });
    } catch (error) {
        next(error);
    }
};

export const updateInventory = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const id = Number(req.params.id);
        const item = await pharmacyService.updateInventory(clinicId, id, req.body);
        res.json({ status: 'success', data: item });
    } catch (error) {
        next(error);
    }
};

export const deleteInventory = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const id = Number(req.params.id);
        await pharmacyService.deleteInventory(clinicId, id);
        res.json({ status: 'success', message: 'Item deleted' });
    } catch (error) {
        next(error);
    }
};

export const getOrders = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const orders = await pharmacyService.getPharmacyOrders(clinicId);
        res.json({ status: 'success', data: orders });
    } catch (error) {
        next(error);
    }
};

export const processOrder = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const { orderId, items, paid, amount, source } = req.body;
        const result = await pharmacyService.processPharmacyOrder(clinicId, orderId, items, paid, amount, source);
        res.json({ status: 'success', data: result });
    } catch (error) {
        next(error);
    }
};
export const directSale = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const result = await pharmacyService.directSale(clinicId, req.body);
        res.status(201).json({ status: 'success', data: result });
    } catch (error) {
        next(error);
    }
};

export const getPosSales = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const sales = await pharmacyService.getPosSales(clinicId);
        res.json({ status: 'success', data: sales });
    } catch (error) {
        next(error);
    }
};

export const updatePosSale = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const invoiceId = req.params.id;
        const result = await pharmacyService.updatePosSale(clinicId, invoiceId, req.body);
        res.json({ status: 'success', data: result });
    } catch (error) {
        next(error);
    }
};

export const deletePosSale = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const invoiceId = req.params.id;
        await pharmacyService.deletePosSale(clinicId, invoiceId);
        res.json({ status: 'success', message: 'Sale deleted' });
    } catch (error) {
        next(error);
    }
};

export const getNotifications = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const count = await pharmacyService.getPharmacyNotificationsCount(clinicId);
        res.json({ status: 'success', data: { count } });
    } catch (error) {
        next(error);
    }
};

export const getInventoryItem = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const id = Number(req.params.id);
        const item = await pharmacyService.getInventoryItem(clinicId, id);
        res.json({ status: 'success', data: item });
    } catch (error) {
        next(error);
    }
};

export const getBatches = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const inventoryId = req.params.id ? Number(req.params.id) : (req.query.inventoryId ? Number(req.query.inventoryId) : undefined);
        const batches = await pharmacyService.getBatches(clinicId, inventoryId);
        res.json({ status: 'success', data: batches });
    } catch (error) {
        next(error);
    }
};

export const addBatch = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const inventoryId = Number(req.params.id);
        const batch = await pharmacyService.addBatch(clinicId, inventoryId, req.body);
        res.status(201).json({ status: 'success', data: batch });
    } catch (error) {
        next(error);
    }
};

export const updateBatch = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const batchId = Number(req.params.batchId);
        const batch = await pharmacyService.updateBatch(clinicId, batchId, req.body);
        res.json({ status: 'success', data: batch });
    } catch (error) {
        next(error);
    }
};

export const deleteBatch = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const batchId = Number(req.params.batchId);
        await pharmacyService.deleteBatch(clinicId, batchId);
        res.json({ status: 'success', message: 'Batch removed' });
    } catch (error) {
        next(error);
    }
};

export const getAlerts = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const { type, severity, status, search, expiringDays } = req.query;
        const result = await pharmacyService.getInventoryAlerts(clinicId, {
            type: type ? String(type) : undefined,
            severity: severity ? String(severity) : undefined,
            status: status ? String(status) : undefined,
            search: search ? String(search) : undefined,
            expiringDays: expiringDays ? Number(expiringDays) : undefined
        });
        res.json({ status: 'success', data: result });
    } catch (error) {
        next(error);
    }
};

export const acknowledgeAlert = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const alertId = Number(req.params.alertId);
        const userName = req.user?.name || req.body?.userName || 'Staff';
        const updated = await pharmacyService.acknowledgeAlert(clinicId, alertId, userName);
        res.json({ status: 'success', data: updated });
    } catch (error) {
        next(error);
    }
};

export const getAlertSettings = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const settings = await pharmacyService.getAlertSettings(clinicId);
        res.json({ status: 'success', data: settings });
    } catch (error) {
        next(error);
    }
};

export const saveAlertSettings = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const settings = await pharmacyService.saveAlertSettings(clinicId, req.body);
        res.json({ status: 'success', data: settings });
    } catch (error) {
        next(error);
    }
};

export const getPurchaseOrders = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const { status } = req.query;
        const orders = await pharmacyService.getPurchaseOrders(clinicId, { status: status ? String(status) : undefined });
        res.json({ status: 'success', data: orders });
    } catch (error) {
        next(error);
    }
};

export const createPurchaseOrder = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const userName = req.user?.name || 'Staff';
        const po = await pharmacyService.createPurchaseOrder(clinicId, req.body, userName);
        res.status(201).json({ status: 'success', data: po });
    } catch (error) {
        next(error);
    }
};

export const updatePurchaseOrderStatus = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const id = Number(req.params.id);
        const { status, receiveDetails } = req.body;
        const updated = await pharmacyService.updatePurchaseOrderStatus(clinicId, id, status, receiveDetails);
        res.json({ status: 'success', data: updated });
    } catch (error) {
        next(error);
    }
};

export const getReports = async (req: any, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.clinicId;
        const date = req.query.date ? String(req.query.date) : new Date().toISOString().split('T')[0];
        const reports = await pharmacyService.getDailySalesReports(clinicId, date);
        res.json({ status: 'success', data: reports });
    } catch (error) {
        next(error);
    }
};
