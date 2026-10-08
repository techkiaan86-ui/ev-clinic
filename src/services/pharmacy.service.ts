import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import * as auditService from './audit.service.js';

const DEFAULT_LOW_STOCK_THRESHOLD = 10;
const DEFAULT_EXPIRING_DAYS_THRESHOLD = 30;

// ── Alert Settings Helpers ──────────────────────────────────────────────────
export const getAlertSettings = async (clinicId: number) => {
    try {
        const setting = await prisma.system_settings.findUnique({
            where: { key: `pharmacy_alert_settings_${clinicId}` }
        });
        if (setting?.value) {
            return JSON.parse(setting.value);
        }
    } catch (_) { }
    return {
        expiringDaysThreshold: 30,
        defaultReorderLevel: 10,
        defaultMaxStock: 100,
        enableAutoNotifications: true,
        notifyOnExpiry: true,
        notifyOnLowStock: true,
        notifyOnOutOfStock: true
    };
};

export const saveAlertSettings = async (clinicId: number, settings: any) => {
    const key = `pharmacy_alert_settings_${clinicId}`;
    const value = JSON.stringify(settings);
    const existing = await prisma.system_settings.findUnique({ where: { key } });
    if (existing) {
        return await prisma.system_settings.update({
            where: { key },
            data: { value, description: `Pharmacy alert settings for clinic #${clinicId}` }
        });
    } else {
        return await prisma.system_settings.create({
            data: { key, value, description: `Pharmacy alert settings for clinic #${clinicId}` }
        });
    }
};

// ── Inventory Item Management ───────────────────────────────────────────────
export const getInventory = async (clinicId: number, filters?: { search?: string; status?: string }) => {
    // Run alert evaluation on fetch to ensure live data consistency
    await evaluateAndSyncAlerts(clinicId).catch(err => console.error('[Pharmacy Alert Sync Error]', err));

    const where: any = { clinicId };
    if (filters?.search) {
        where.OR = [
            { name: { contains: filters.search } },
            { sku: { contains: filters.search } },
            { batchNumber: { contains: filters.search } },
            { supplier: { contains: filters.search } }
        ];
    }
    if (filters?.status && filters.status !== 'ALL') {
        where.status = filters.status;
    }

    const items = await prisma.inventory.findMany({
        where,
        orderBy: { name: 'asc' }
    });

    // Fetch batches for all items
    const batches = await prisma.inventory_batch.findMany({
        where: { clinicId },
        orderBy: { expiryDate: 'asc' }
    });

    const now = new Date();
    const settings = await getAlertSettings(clinicId);
    const expiringDays = Number(settings.expiringDaysThreshold) || 30;

    return items.map(item => {
        const itemBatches = batches.filter(b => b.inventoryId === item.id);
        const totalBatchQty = itemBatches.reduce((acc, b) => acc + b.quantity, 0);
        const effectiveQty = itemBatches.length > 0 ? totalBatchQty : item.quantity;

        // Determine stock status
        let stockStatus = 'IN_STOCK';
        if (effectiveQty === 0) stockStatus = 'OUT_OF_STOCK';
        else if (effectiveQty <= (item.reorderLevel || DEFAULT_LOW_STOCK_THRESHOLD)) stockStatus = 'LOW_STOCK';

        // Find earliest active expiry
        let nearestExpiry = item.expiryDate;
        let isExpired = false;
        let isExpiringSoon = false;
        let daysUntilExpiry: number | null = null;

        const activeBatchesWithExpiry = itemBatches.filter(b => b.expiryDate && b.quantity > 0);
        if (activeBatchesWithExpiry.length > 0) {
            nearestExpiry = activeBatchesWithExpiry[0].expiryDate;
        }

        if (nearestExpiry) {
            const exp = new Date(nearestExpiry);
            const diffTime = exp.getTime() - now.getTime();
            daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (daysUntilExpiry < 0) isExpired = true;
            else if (daysUntilExpiry <= expiringDays) isExpiringSoon = true;
        }

        return {
            ...item,
            quantity: effectiveQty,
            stockStatus,
            batches: itemBatches,
            batchCount: itemBatches.length,
            nearestExpiry,
            daysUntilExpiry,
            isExpired,
            isExpiringSoon,
            recommendedOrder: Math.max(0, (item.maxStock || 100) - effectiveQty)
        };
    });
};

export const getInventoryItem = async (clinicId: number, id: number) => {
    const item = await prisma.inventory.findFirst({
        where: { id, clinicId }
    });
    if (!item) throw new AppError('Inventory item not found', 404);

    const batches = await prisma.inventory_batch.findMany({
        where: { inventoryId: id, clinicId },
        orderBy: { expiryDate: 'asc' }
    });

    const alerts = await prisma.inventory_alert.findMany({
        where: { inventoryId: id, clinicId, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
        orderBy: { dateDetected: 'desc' }
    });

    return { ...item, batches, alerts };
};

export const getLowStockInventory = async (clinicId: number, threshold: number = DEFAULT_LOW_STOCK_THRESHOLD) => {
    return await prisma.inventory.findMany({
        where: {
            clinicId,
            quantity: { lte: threshold }
        },
        orderBy: { quantity: 'asc' }
    });
};

export const addInventory = async (clinicId: number, data: any) => {
    const { 
        name, sku, batchNumber, quantity, reorderLevel, maxStock, 
        unitPrice, purchasePrice, supplier, location, expiryDate, status 
    } = data;

    const initialQty = Number(quantity) || 0;
    const itemExpiry = expiryDate ? new Date(expiryDate) : null;

    const created = await prisma.inventory.create({
        data: {
            clinicId,
            name: name.trim(),
            sku: sku?.trim() || null,
            batchNumber: batchNumber?.trim() || null,
            quantity: initialQty,
            reorderLevel: Number(reorderLevel) || DEFAULT_LOW_STOCK_THRESHOLD,
            maxStock: Number(maxStock) || 100,
            unitPrice: Number(unitPrice) || 0,
            purchasePrice: purchasePrice ? Number(purchasePrice) : null,
            supplier: supplier?.trim() || null,
            location: location?.trim() || null,
            status: status || 'ACTIVE',
            expiryDate: itemExpiry
        }
    });

    // If batch number is provided, automatically record the initial batch
    if (batchNumber && initialQty > 0 && itemExpiry) {
        await prisma.inventory_batch.create({
            data: {
                clinicId,
                inventoryId: created.id,
                batchNumber: batchNumber.trim(),
                quantity: initialQty,
                expiryDate: itemExpiry,
                purchasePrice: purchasePrice ? Number(purchasePrice) : null,
                unitPrice: Number(unitPrice) || null,
                supplier: supplier?.trim() || null,
                location: location?.trim() || null,
                status: 'ACTIVE'
            }
        });
    }

    await evaluateAndSyncAlerts(clinicId).catch(err => console.error('[Pharmacy Alert Sync Error]', err));
    return created;
};

export const updateInventory = async (clinicId: number, id: number, data: any) => {
    const existing = await prisma.inventory.findFirst({ where: { id, clinicId } });
    if (!existing) throw new AppError('Inventory item not found', 404);

    const updated = await prisma.inventory.update({
        where: { id },
        data: {
            name: data.name !== undefined ? data.name.trim() : existing.name,
            sku: data.sku !== undefined ? data.sku?.trim() || null : existing.sku,
            batchNumber: data.batchNumber !== undefined ? data.batchNumber?.trim() || null : existing.batchNumber,
            quantity: data.quantity !== undefined ? Number(data.quantity) : existing.quantity,
            reorderLevel: data.reorderLevel !== undefined ? Number(data.reorderLevel) : existing.reorderLevel,
            maxStock: data.maxStock !== undefined ? Number(data.maxStock) : existing.maxStock,
            unitPrice: data.unitPrice !== undefined ? Number(data.unitPrice) : existing.unitPrice,
            purchasePrice: data.purchasePrice !== undefined ? (data.purchasePrice ? Number(data.purchasePrice) : null) : existing.purchasePrice,
            supplier: data.supplier !== undefined ? data.supplier?.trim() || null : existing.supplier,
            location: data.location !== undefined ? data.location?.trim() || null : existing.location,
            status: data.status !== undefined ? data.status : existing.status,
            expiryDate: data.expiryDate !== undefined ? (data.expiryDate ? new Date(data.expiryDate) : null) : existing.expiryDate
        }
    });

    await evaluateAndSyncAlerts(clinicId).catch(err => console.error('[Pharmacy Alert Sync Error]', err));
    return updated;
};

export const deleteInventory = async (clinicId: number, id: number) => {
    const existing = await prisma.inventory.findFirst({ where: { id, clinicId } });
    if (!existing) throw new AppError('Inventory item not found', 404);

    // Delete associated batches and alerts
    await prisma.inventory_batch.deleteMany({ where: { inventoryId: id, clinicId } });
    await prisma.inventory_alert.deleteMany({ where: { inventoryId: id, clinicId } });
    return await prisma.inventory.delete({ where: { id } });
};

// ── Batch Level Management ──────────────────────────────────────────────────
export const getBatches = async (clinicId: number, inventoryId?: number) => {
    const where: any = { clinicId };
    if (inventoryId) where.inventoryId = Number(inventoryId);

    const batches = await prisma.inventory_batch.findMany({
        where,
        orderBy: { expiryDate: 'asc' }
    });

    const now = new Date();
    return batches.map(b => {
        const exp = new Date(b.expiryDate);
        const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return {
            ...b,
            daysUntilExpiry: diffDays,
            isExpired: diffDays < 0,
            isExpiringSoon: diffDays >= 0 && diffDays <= 30
        };
    });
};

export const addBatch = async (clinicId: number, inventoryId: number, data: any) => {
    const item = await prisma.inventory.findFirst({ where: { id: inventoryId, clinicId } });
    if (!item) throw new AppError('Medicine item not found', 404);

    const { batchNumber, quantity, expiryDate, purchasePrice, unitPrice, supplier, location } = data;
    const batchQty = Number(quantity) || 0;
    const expDate = new Date(expiryDate);

    const batch = await prisma.inventory_batch.create({
        data: {
            clinicId,
            inventoryId,
            batchNumber: batchNumber.trim(),
            quantity: batchQty,
            expiryDate: expDate,
            purchasePrice: purchasePrice ? Number(purchasePrice) : item.purchasePrice,
            unitPrice: unitPrice ? Number(unitPrice) : item.unitPrice,
            supplier: supplier ? supplier.trim() : item.supplier,
            location: location ? location.trim() : item.location,
            status: 'ACTIVE'
        }
    });

    // Recalculate parent item total quantity and update nearest expiry
    const allBatches = await prisma.inventory_batch.findMany({ where: { inventoryId, clinicId } });
    const totalQty = allBatches.reduce((acc, b) => acc + b.quantity, 0);
    const sortedActive = allBatches.filter(b => b.quantity > 0).sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
    const nearestExpiry = sortedActive.length > 0 ? sortedActive[0].expiryDate : expDate;

    await prisma.inventory.update({
        where: { id: inventoryId },
        data: {
            quantity: totalQty,
            expiryDate: nearestExpiry,
            batchNumber: batchNumber.trim()
        }
    });

    await evaluateAndSyncAlerts(clinicId).catch(err => console.error('[Pharmacy Alert Sync Error]', err));
    return batch;
};

export const updateBatch = async (clinicId: number, batchId: number, data: any) => {
    const existing = await prisma.inventory_batch.findFirst({ where: { id: batchId, clinicId } });
    if (!existing) throw new AppError('Batch record not found', 404);

    const updated = await prisma.inventory_batch.update({
        where: { id: batchId },
        data: {
            batchNumber: data.batchNumber !== undefined ? data.batchNumber.trim() : existing.batchNumber,
            quantity: data.quantity !== undefined ? Number(data.quantity) : existing.quantity,
            expiryDate: data.expiryDate !== undefined ? new Date(data.expiryDate) : existing.expiryDate,
            purchasePrice: data.purchasePrice !== undefined ? (data.purchasePrice ? Number(data.purchasePrice) : null) : existing.purchasePrice,
            unitPrice: data.unitPrice !== undefined ? (data.unitPrice ? Number(data.unitPrice) : null) : existing.unitPrice,
            supplier: data.supplier !== undefined ? data.supplier?.trim() : existing.supplier,
            location: data.location !== undefined ? data.location?.trim() : existing.location,
            status: data.status !== undefined ? data.status : existing.status
        }
    });

    // Sync parent inventory item quantity and nearest expiry
    const allBatches = await prisma.inventory_batch.findMany({ where: { inventoryId: existing.inventoryId, clinicId } });
    const totalQty = allBatches.reduce((acc, b) => acc + b.quantity, 0);
    const sortedActive = allBatches.filter(b => b.quantity > 0).sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

    await prisma.inventory.update({
        where: { id: existing.inventoryId },
        data: {
            quantity: totalQty,
            expiryDate: sortedActive.length > 0 ? sortedActive[0].expiryDate : null
        }
    });

    await evaluateAndSyncAlerts(clinicId).catch(err => console.error('[Pharmacy Alert Sync Error]', err));
    return updated;
};

export const deleteBatch = async (clinicId: number, batchId: number) => {
    const existing = await prisma.inventory_batch.findFirst({ where: { id: batchId, clinicId } });
    if (!existing) throw new AppError('Batch record not found', 404);

    await prisma.inventory_batch.delete({ where: { id: batchId } });

    // Sync parent
    const allBatches = await prisma.inventory_batch.findMany({ where: { inventoryId: existing.inventoryId, clinicId } });
    const totalQty = allBatches.reduce((acc, b) => acc + b.quantity, 0);
    const sortedActive = allBatches.filter(b => b.quantity > 0).sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

    await prisma.inventory.update({
        where: { id: existing.inventoryId },
        data: {
            quantity: totalQty,
            expiryDate: sortedActive.length > 0 ? sortedActive[0].expiryDate : null
        }
    });

    await evaluateAndSyncAlerts(clinicId).catch(err => console.error('[Pharmacy Alert Sync Error]', err));
    return { success: true };
};

// ── Alert Engine & Evaluation ────────────────────────────────────────────────
export const evaluateAndSyncAlerts = async (clinicId: number) => {
    const [items, batches, settings] = await Promise.all([
        prisma.inventory.findMany({ where: { clinicId } }),
        prisma.inventory_batch.findMany({ where: { clinicId } }),
        getAlertSettings(clinicId)
    ]);

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const expiringDays = Number(settings.expiringDaysThreshold) || 30;

    const detectedAlerts: any[] = [];

    // 1. Evaluate stock levels (Out of Stock & Low Stock)
    for (const item of items) {
        const itemBatches = batches.filter(b => b.inventoryId === item.id);
        const currentStock = itemBatches.length > 0 ? itemBatches.reduce((acc, b) => acc + b.quantity, 0) : item.quantity;
        const reorderLevel = item.reorderLevel || DEFAULT_LOW_STOCK_THRESHOLD;

        if (currentStock === 0) {
            detectedAlerts.push({
                clinicId,
                inventoryId: item.id,
                batchId: null,
                medicineName: item.name,
                batchNumber: item.batchNumber || null,
                alertType: 'OUT_OF_STOCK',
                severity: 'CRITICAL',
                currentStock: 0,
                reorderLevel,
                expiryDate: item.expiryDate,
                supplier: item.supplier,
                message: `🚨 Out of Stock: ${item.name} has 0 units remaining (Reorder Level: ${reorderLevel}). Dispensing is blocked until restocked.`
            });
        } else if (currentStock <= reorderLevel) {
            const recommended = Math.max(0, (item.maxStock || 100) - currentStock);
            detectedAlerts.push({
                clinicId,
                inventoryId: item.id,
                batchId: null,
                medicineName: item.name,
                batchNumber: item.batchNumber || null,
                alertType: 'LOW_STOCK',
                severity: 'HIGH',
                currentStock,
                reorderLevel,
                expiryDate: item.expiryDate,
                supplier: item.supplier,
                message: `⚠️ Low Stock: ${item.name} (Current: ${currentStock}, Reorder Level: ${reorderLevel}). Recommended Reorder Quantity: ${recommended} units.`
            });
        }

        // 2. Evaluate Item-level expiry (if no separate batches)
        if (itemBatches.length === 0 && item.expiryDate && currentStock > 0) {
            const expDate = new Date(item.expiryDate);
            expDate.setHours(0, 0, 0, 0);
            const diffDays = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            const formattedExp = expDate.toISOString().slice(0, 10);

            if (diffDays < 0) {
                detectedAlerts.push({
                    clinicId,
                    inventoryId: item.id,
                    batchId: null,
                    medicineName: item.name,
                    batchNumber: item.batchNumber || 'Standard',
                    alertType: 'EXPIRED',
                    severity: 'CRITICAL',
                    currentStock,
                    reorderLevel,
                    expiryDate: expDate,
                    supplier: item.supplier,
                    message: `🚨 Expired: ${item.name}${item.batchNumber ? ` (Batch ${item.batchNumber})` : ''} expired ${Math.abs(diffDays)} days ago on ${formattedExp}. Must be quarantined immediately.`
                });
            } else if (diffDays <= expiringDays) {
                detectedAlerts.push({
                    clinicId,
                    inventoryId: item.id,
                    batchId: null,
                    medicineName: item.name,
                    batchNumber: item.batchNumber || 'Standard',
                    alertType: 'EXPIRING_SOON',
                    severity: diffDays <= 7 ? 'HIGH' : 'MEDIUM',
                    currentStock,
                    reorderLevel,
                    expiryDate: expDate,
                    supplier: item.supplier,
                    message: `⚠️ Expiring Soon: ${item.name}${item.batchNumber ? ` (Batch ${item.batchNumber})` : ''} expires in ${diffDays} days (${formattedExp}).`
                });
            }
        }
    }

    // 3. Evaluate Batch-level expiries
    for (const batch of batches) {
        if (batch.quantity <= 0 || !batch.expiryDate) continue;
        const parentItem = items.find(i => i.id === batch.inventoryId);
        const medicineName = parentItem?.name || 'Medicine Item';

        const expDate = new Date(batch.expiryDate);
        expDate.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const formattedExp = expDate.toISOString().slice(0, 10);

        if (diffDays < 0) {
            detectedAlerts.push({
                clinicId,
                inventoryId: batch.inventoryId,
                batchId: batch.id,
                medicineName,
                batchNumber: batch.batchNumber,
                alertType: 'EXPIRED',
                severity: 'CRITICAL',
                currentStock: batch.quantity,
                reorderLevel: parentItem?.reorderLevel || DEFAULT_LOW_STOCK_THRESHOLD,
                expiryDate: expDate,
                supplier: batch.supplier || parentItem?.supplier,
                message: `🚨 Expired Batch: ${medicineName} (Batch #${batch.batchNumber}) expired ${Math.abs(diffDays)} days ago on ${formattedExp}. Quarantine ${batch.quantity} units.`
            });
        } else if (diffDays <= expiringDays) {
            detectedAlerts.push({
                clinicId,
                inventoryId: batch.inventoryId,
                batchId: batch.id,
                medicineName,
                batchNumber: batch.batchNumber,
                alertType: 'EXPIRING_SOON',
                severity: diffDays <= 7 ? 'HIGH' : 'MEDIUM',
                currentStock: batch.quantity,
                reorderLevel: parentItem?.reorderLevel || DEFAULT_LOW_STOCK_THRESHOLD,
                expiryDate: expDate,
                supplier: batch.supplier || parentItem?.supplier,
                message: `⚠️ Expiring Soon: ${medicineName} (Batch #${batch.batchNumber}) expires in ${diffDays} days on ${formattedExp} (${batch.quantity} units).`
            });
        }
    }

    // Synchronize detected alerts with inventory_alert table
    const existingAlerts = await prisma.inventory_alert.findMany({
        where: { clinicId }
    });

    for (const d of detectedAlerts) {
        const match = existingAlerts.find(e => 
            e.inventoryId === d.inventoryId && 
            e.batchId === d.batchId && 
            e.alertType === d.alertType &&
            e.status !== 'RESOLVED'
        );

        if (match) {
            // Update latest message and numbers without clearing acknowledgement if already acknowledged
            await prisma.inventory_alert.update({
                where: { id: match.id },
                data: {
                    currentStock: d.currentStock,
                    reorderLevel: d.reorderLevel,
                    expiryDate: d.expiryDate,
                    message: d.message,
                    severity: d.severity
                }
            });
        } else {
            // Insert new alert
            await prisma.inventory_alert.create({
                data: {
                    clinicId: d.clinicId,
                    inventoryId: d.inventoryId,
                    batchId: d.batchId,
                    medicineName: d.medicineName,
                    batchNumber: d.batchNumber,
                    alertType: d.alertType,
                    severity: d.severity,
                    currentStock: d.currentStock,
                    reorderLevel: d.reorderLevel,
                    expiryDate: d.expiryDate,
                    supplier: d.supplier,
                    message: d.message,
                    status: 'ACTIVE'
                }
            });

            // Create notification for staff if enabled
            if (settings.enableAutoNotifications) {
                await prisma.notification.create({
                    data: {
                        clinicId,
                        department: 'pharmacy',
                        message: d.message,
                        status: 'unread'
                    }
                }).catch(() => {});
            }
        }
    }

    // Resolve old alerts that are no longer active
    for (const ex of existingAlerts.filter(e => e.status !== 'RESOLVED')) {
        const stillActive = detectedAlerts.some(d => 
            d.inventoryId === ex.inventoryId && 
            d.batchId === ex.batchId && 
            d.alertType === ex.alertType
        );
        if (!stillActive) {
            await prisma.inventory_alert.update({
                where: { id: ex.id },
                data: { status: 'RESOLVED' }
            });
        }
    }
};

export const getInventoryAlerts = async (clinicId: number, filters?: { 
    type?: string; 
    severity?: string; 
    status?: string; 
    search?: string; 
    expiringDays?: number;
}) => {
    // Run evaluation
    await evaluateAndSyncAlerts(clinicId).catch(err => console.error('[Pharmacy Alert Sync Error]', err));

    const where: any = { 
        clinicId,
        status: filters?.status && filters.status !== 'ALL' ? filters.status : { in: ['ACTIVE', 'ACKNOWLEDGED'] }
    };

    if (filters?.type && filters.type !== 'ALL') {
        where.alertType = filters.type;
    }
    if (filters?.severity && filters.severity !== 'ALL') {
        where.severity = filters.severity;
    }
    if (filters?.search) {
        where.OR = [
            { medicineName: { contains: filters.search } },
            { batchNumber: { contains: filters.search } },
            { supplier: { contains: filters.search } },
            { message: { contains: filters.search } }
        ];
    }

    const alerts = await prisma.inventory_alert.findMany({
        where,
        orderBy: [
            { severity: 'asc' }, // CRITICAL first
            { dateDetected: 'desc' }
        ]
    });

    // Calculate Summary Counts
    const allActive = await prisma.inventory_alert.findMany({
        where: { clinicId, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } }
    });

    const summary = {
        total: allActive.length,
        expired: allActive.filter(a => a.alertType === 'EXPIRED').length,
        expiringSoon: allActive.filter(a => a.alertType === 'EXPIRING_SOON').length,
        lowStock: allActive.filter(a => a.alertType === 'LOW_STOCK').length,
        outOfStock: allActive.filter(a => a.alertType === 'OUT_OF_STOCK').length,
        critical: allActive.filter(a => a.severity === 'CRITICAL').length
    };

    const now = new Date();
    const formattedAlerts = alerts.map(a => {
        let daysUntilExpiry: number | null = null;
        if (a.expiryDate) {
            const exp = new Date(a.expiryDate);
            daysUntilExpiry = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        }
        return {
            ...a,
            daysUntilExpiry
        };
    });

    return {
        summary,
        alerts: formattedAlerts
    };
};

export const acknowledgeAlert = async (clinicId: number, alertId: number, userName: string = 'Staff') => {
    const alert = await prisma.inventory_alert.findFirst({ where: { id: alertId, clinicId } });
    if (!alert) throw new AppError('Alert not found', 404);

    return await prisma.inventory_alert.update({
        where: { id: alertId },
        data: {
            status: 'ACKNOWLEDGED',
            acknowledgedBy: userName,
            acknowledgedAt: new Date()
        }
    });
};

// ── Purchase Orders & Reordering ────────────────────────────────────────────
export const getPurchaseOrders = async (clinicId: number, filters?: { status?: string }) => {
    const where: any = { clinicId };
    if (filters?.status && filters.status !== 'ALL') {
        where.status = filters.status;
    }
    return await prisma.purchase_order.findMany({
        where,
        orderBy: { createdAt: 'desc' }
    });
};

export const createPurchaseOrder = async (clinicId: number, data: any, userName: string = 'Admin') => {
    const { supplier, items, notes, status = 'ORDERED' } = data;
    if (!supplier || !items || !Array.isArray(items) || items.length === 0) {
        throw new AppError('Supplier and at least one item are required for purchase order', 400);
    }

    const count = await prisma.purchase_order.count({ where: { clinicId } });
    const poNumber = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

    let totalAmount = 0;
    const sanitizedItems = items.map((i: any) => {
        const qty = Number(i.quantity) || 1;
        const price = Number(i.purchasePrice || i.unitPrice || 0);
        const subtotal = qty * price;
        totalAmount += subtotal;
        return {
            inventoryId: i.inventoryId ? Number(i.inventoryId) : null,
            medicineName: i.medicineName || i.name || 'Item',
            batchNumber: i.batchNumber || null,
            quantity: qty,
            purchasePrice: price,
            subtotal,
            currentStock: i.currentStock ?? null,
            reorderLevel: i.reorderLevel ?? null,
            expiryDate: i.expiryDate || null
        };
    });

    const po = await prisma.purchase_order.create({
        data: {
            clinicId,
            poNumber,
            supplier: supplier.trim(),
            status,
            totalAmount,
            items: sanitizedItems,
            notes: notes?.trim() || null,
            orderedBy: userName,
            orderedAt: new Date()
        }
    });

    return po;
};

export const updatePurchaseOrderStatus = async (clinicId: number, id: number, status: string, receiveDetails?: any) => {
    const po = await prisma.purchase_order.findFirst({ where: { id, clinicId } });
    if (!po) throw new AppError('Purchase order not found', 404);

    return await prisma.$transaction(async (tx) => {
        const updateData: any = { status };
        if (status === 'RECEIVED') {
            updateData.receivedAt = new Date();

            // Auto-restock inventory and create received batches
            const items = Array.isArray(po.items) ? (po.items as any[]) : [];
            for (const item of items) {
                if (item.inventoryId) {
                    const inv = await tx.inventory.findUnique({ where: { id: item.inventoryId } });
                    if (inv) {
                        const newQty = inv.quantity + (Number(item.quantity) || 0);
                        const batchNum = item.batchNumber || `B-${Date.now().toString().slice(-6)}`;
                        const expDate = item.expiryDate ? new Date(item.expiryDate) : (inv.expiryDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));

                        // Create batch
                        await tx.inventory_batch.create({
                            data: {
                                clinicId,
                                inventoryId: inv.id,
                                batchNumber: batchNum,
                                quantity: Number(item.quantity) || 0,
                                expiryDate: expDate,
                                purchasePrice: item.purchasePrice ? Number(item.purchasePrice) : inv.purchasePrice,
                                unitPrice: inv.unitPrice,
                                supplier: po.supplier,
                                status: 'ACTIVE'
                            }
                        });

                        // Update parent item
                        await tx.inventory.update({
                            where: { id: inv.id },
                            data: {
                                quantity: newQty,
                                purchasePrice: item.purchasePrice ? Number(item.purchasePrice) : inv.purchasePrice,
                                supplier: po.supplier,
                                status: 'ACTIVE'
                            }
                        });
                    }
                }
            }
        }

        const updated = await tx.purchase_order.update({
            where: { id },
            data: updateData
        });

        return updated;
    });
};

export const getPharmacyOrders = async (clinicId: number) => {
    console.log(`[PHARMACY] Fetching orders/prescriptions for clinic ${clinicId}`);

    // 1. Get Service Orders for Pharmacy (legacy/quick-orders)
    const serviceOrders = await prisma.service_order.findMany({
        where: {
            clinicId,
            type: { in: ['PHARMACY', 'Pharmacy', 'pharmacy'] }
        },
        include: {
            patient: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' }
    });

    // 2. Get Prescriptions from Medical Records (new EMR flow)
    const prescribedRecords = await prisma.medicalrecord.findMany({
        where: {
            clinicId,
            type: 'PRESCRIPTION',
            // status: { not: 'Dispensed' } // Removed to include Completed/Dispensed orders
        },
        include: {
            patient: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' }
    });

    const combined = [
        ...serviceOrders.map((o: any) => {
            let items = [];
            try {
                if (o.result && (o.result.startsWith('{') || o.result.startsWith('['))) {
                    const parsed = JSON.parse(o.result);
                    if (Array.isArray(parsed.items)) {
                        items = parsed.items;
                    } else if (parsed.medicineName || parsed.name || parsed.testName) {
                        if (!parsed.medicineName && parsed.testName) parsed.medicineName = parsed.testName;
                        items = [parsed];
                    }
                }
            } catch (e) {
                console.error("Failed to parse order result for pharmacy:", o.id);
            }

            return {
                id: o.id,
                patientName: o.patient?.name,
                testName: items.length > 0
                    ? items.map((i: any) => i.medicineName || i.name || 'Medicine').join(', ')
                    : o.testName,
                items: items,
                status: o.testStatus || o.status,
                paymentStatus: o.paymentStatus,
                result: o.result,
                createdAt: o.createdAt,
                source: 'ORDER'
            };
        }),
        ...prescribedRecords.map((r: any) => {
            let data: any = {};
            try {
                data = JSON.parse(r.data);
            } catch (e) {
                console.error("Failed to parse prescription data for record:", r.id);
            }

            // Fallback for legacy format: if data is a single item (has medicineName but no items array)
            let prescriptionItems = [];
            if (Array.isArray(data.items)) {
                prescriptionItems = data.items;
            } else if (data.medicineName || data.name || data.testName) {
                // Ensure medicineName exists for frontend display
                if (!data.medicineName && data.testName) {
                    data.medicineName = data.testName;
                }
                prescriptionItems = [data]; // Wrap single item into array
            }

            return {
                id: r.id,
                patientName: r.patient?.name,
                testName: prescriptionItems.length > 0
                    ? prescriptionItems.map((i: any) => i.medicineName || i.name || 'Medicine').join(', ')
                    : 'Prescription',
                items: prescriptionItems,
                status: r.status === 'Dispensed' ? 'Completed' : r.status, // Map to Completed for frontend
                paymentStatus: 'Paid',
                result: r.data, // Map data to result so frontend can parse invoice/items if present
                createdAt: r.createdAt,
                source: 'EMR'
            };
        })
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return combined;
};

export const getPharmacyNotificationsCount = async (clinicId: number) => {
    return await prisma.notification.count({
        where: {
            clinicId,
            department: {
                contains: 'pharmacy',
                // mode: 'insensitive' // Optional, based on DB support
            },
            status: 'unread'
        }
    });
};

export const processPharmacyOrder = async (clinicId: number, orderId: number, items: any[] = [], paid: boolean = false, manualAmount?: number, source: 'ORDER' | 'EMR' = 'ORDER') => {
    // If no items passed, use prescription items from order (doctor-prescribed)
    if (!items || items.length === 0) {
        if (source === 'ORDER') {
            const order = await prisma.service_order.findFirst({ where: { id: orderId, clinicId } });
            if (order?.result) {
                try {
                    const parsed = JSON.parse(order.result);
                    if (Array.isArray(parsed?.items) && parsed.items.length > 0) {
                        items = parsed.items.map((i: any) => ({
                            inventoryId: i.inventoryId,
                            quantity: Number(i.quantity) || 1,
                            price: i.unitPrice ?? i.price
                        }));
                    }
                } catch (_) { }
            }
        } else {
            const record = await prisma.medicalrecord.findFirst({ where: { id: orderId, clinicId } });
            if (record?.data) {
                try {
                    const parsed = JSON.parse(record.data);

                    // Support both new {items: []} format and legacy single item format
                    let rawItems = [];
                    if (Array.isArray(parsed?.items)) {
                        rawItems = parsed.items;
                    } else if (parsed?.medicineName || parsed?.name || parsed?.testName) {
                        // Ensure medicineName exists for processing
                        if (!parsed.medicineName && parsed.testName) {
                            parsed.medicineName = parsed.testName;
                        }
                        rawItems = [parsed];
                    }

                    if (rawItems.length > 0) {
                        items = rawItems.map((i: any) => ({
                            inventoryId: i.inventoryId || i.id, // Fallback to id if inventoryId not present
                            quantity: Number(i.quantity) || 1,
                            price: i.unitPrice ?? i.price
                        }));
                    }
                } catch (_) { }
            }
        }
    }

    try {
        const order = source === 'ORDER'
            ? await prisma.service_order.findFirst({ where: { id: orderId, clinicId } })
            : await prisma.medicalrecord.findFirst({ where: { id: orderId, clinicId } });

        if (!order) throw new AppError('Order/Prescription not found', 404);

        // Strict Centralized Billing Rule
        if ((order as any).paymentStatus !== 'Paid' && (source === 'ORDER')) {
            throw new AppError('This order has not been paid for yet. Please direct the patient to the reception for billing.', 400);
        }

        return await prisma.$transaction(async (tx) => {
            let totalAmount = Number(manualAmount) || 0;
            let serviceDetails: string[] = [];

            // If items are provided, calculate total and update inventory
            if (items && items.length > 0) {
                let inventoryTotal = 0;
                for (const item of items) {
                    if (!item.inventoryId) continue;

                    const product = await tx.inventory.findUnique({
                        where: { id: item.inventoryId }
                    });

                    if (!product) continue;

                    if (product.quantity < item.quantity) {
                        throw new AppError(`Insufficient stock for ${product?.name || 'Item'}`, 400);
                    }

                    await tx.inventory.update({
                        where: { id: item.inventoryId },
                        data: { quantity: product.quantity - item.quantity }
                    });

                    inventoryTotal += Number(item.price || item.unitPrice || product.unitPrice) * item.quantity;
                    serviceDetails.push(`${product.name} x${item.quantity}`);
                }
                if (!manualAmount && inventoryTotal > 0) totalAmount = inventoryTotal;
            }

            let patientId: number;
            let doctorId: number;
            let description: string;

            if (source === 'ORDER') {
                const order = await tx.service_order.update({
                    where: { id: orderId },
                    data: { testStatus: 'Completed' }
                });
                patientId = order.patientId;
                doctorId = order.doctorId;
                description = order.testName;
            } else {
                const record = await tx.medicalrecord.update({
                    where: { id: orderId },
                    data: { status: 'Dispensed', isClosed: true }
                });
                patientId = record.patientId;
                doctorId = record.doctorId;
                try {
                    const parsed = JSON.parse(record.data);
                    description = Array.isArray(parsed.items)
                        ? parsed.items.map((i: any) => i.medicineName || i.medicine || i).join(', ')
                        : 'Prescription';
                } catch {
                    description = 'Prescription';
                }
            }


            if (serviceDetails.length === 0) {
                try {
                    const parsed = JSON.parse(description);
                    if (Array.isArray(parsed)) description = parsed.map((i: any) => i.medicine || i.name || i).join(', ');
                } catch (e) { }
                serviceDetails.push(description || `Prescription #${orderId}`);
            }

            // Invoice creation removed - handled by Reception Centralized Billing
            // We just update the statuses to mark it as Dispensed

            // Update Order/Record with result/metadata
            if (source === 'ORDER') {
                await tx.service_order.update({
                    where: { id: orderId },
                    data: {
                        result: JSON.stringify({
                            amount: totalAmount,
                            items: serviceDetails,
                            dispensedAt: new Date()
                        })
                    }
                });
            } else {
                try {
                    const record = await tx.medicalrecord.findUnique({ where: { id: orderId } });
                    if (record) {
                        const parsedData = JSON.parse(record.data);
                        parsedData.amount = totalAmount;
                        parsedData.isDispensed = true;
                        parsedData.dispensedAt = new Date();

                        await tx.medicalrecord.update({
                            where: { id: orderId },
                            data: { data: JSON.stringify(parsedData) }
                        });
                    }
                } catch (e) {
                    console.error("Failed to update medicalrecord data", e);
                }
            }

            return { success: true };
        });
    } catch (error) {
        console.error(`[Pharmacy Service] Error processing ${source} ${orderId}:`, error);
        throw error;
    }
};


export const directSale = async (clinicId: number, data: any) => {
    const { patientId, items } = data;

    return await prisma.$transaction(async (tx) => {
        let totalAmount = 0;
        let serviceDetails = [];

        for (const item of items) {
            const product = await tx.inventory.findUnique({
                where: { id: item.inventoryId }
            });

            if (!product || product.quantity < item.quantity) {
                throw new AppError(`Insufficient stock for ${product?.name || 'Item'}`, 400);
            }

            // Deduct stock
            await tx.inventory.update({
                where: { id: item.inventoryId },
                data: { quantity: product.quantity - item.quantity }
            });

            totalAmount += Number(item.price || product.unitPrice) * item.quantity;
            serviceDetails.push(`${product.name} x${item.quantity}`);
        }

        // Create as a Service Order instead of an Invoice
        const order = await tx.service_order.create({
            data: {
                clinicId,
                patientId: Number(patientId),
                doctorId: 0,
                type: 'PHARMACY',
                testName: `Walk-in Pharmacy Sale: ${serviceDetails.join(', ')}`,
                amount: totalAmount,
                paymentStatus: 'Pending',
                testStatus: 'Pending'
            }
        });

        return { order };
    });
};

export const getPosSales = async (clinicId: number) => {
    return await prisma.invoice.findMany({
        where: {
            clinicId,
            items: {
                some: {
                    description: { contains: 'Pharmacy' }
                }
            }
        },
        include: {
            patient: { select: { id: true, name: true, email: true } },
            items: true
        },
        orderBy: { createdAt: 'desc' }
    });
};

export const updatePosSale = async (clinicId: number, invoiceId: string, data: any) => {
    const { status } = data;
    return await prisma.invoice.update({
        where: { id: invoiceId, clinicId },
        data: status != null ? { status: String(status) } : {}
    });
};

export const deletePosSale = async (clinicId: number, invoiceId: string) => {
    await prisma.invoice.delete({ where: { id: invoiceId, clinicId } });
    return { message: 'Sale deleted' };
};

export const getDailySalesReports = async (clinicId: number, dateStr: string) => {
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

    const invoices = await prisma.invoice.findMany({
        where: {
            clinicId,
            createdAt: {
                gte: startOfDay,
                lte: endOfDay
            },
            items: {
                some: {
                    serviceType: 'pharmacy'
                }
            }
        },
        include: {
            patient: { select: { name: true } },
            items: {
                where: { serviceType: 'pharmacy' }
            }
        },
        orderBy: { createdAt: 'desc' }
    });

    const dailyStats = {
        totalCount: invoices.length,
        totalRevenue: invoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0),
        medicines: [] as any[]
    };

    const medicineMap = new Map<string, { quantity: number, total: number }>();

    invoices.forEach(inv => {
        inv.items.forEach(item => {
            const name = item.description;
            // Parse quantity if possible from description (e.g. "Medicine x2")
            let qty = 1;
            const match = name.match(/x(\d+)$/);
            if (match) {
                qty = parseInt(match[1]);
            }

            const current = medicineMap.get(name) || { quantity: 0, total: 0 };
            medicineMap.set(name, {
                quantity: current.quantity + qty,
                total: current.total + Number(item.amount)
            });
        });
    });

    dailyStats.medicines = Array.from(medicineMap.entries()).map(([name, data]) => ({
        name,
        quantity: data.quantity,
        totalAmount: data.total
    }));

    type ShiftKey = 'Morning' | 'Evening' | 'Night';

    const shiftStats: Record<ShiftKey, { count: number, revenue: number, medicines: any[] }> = {
        Morning: { count: 0, revenue: 0, medicines: [] },
        Evening: { count: 0, revenue: 0, medicines: [] },
        Night: { count: 0, revenue: 0, medicines: [] }
    };

    const getShift = (date: Date): ShiftKey => {
        const h = date.getUTCHours();
        if (h >= 6 && h < 14) return 'Morning';
        if (h >= 14 && h < 22) return 'Evening';
        return 'Night';
    };

    const shiftMedicineMaps = {
        Morning: new Map<string, { quantity: number, total: number }>(),
        Evening: new Map<string, { quantity: number, total: number }>(),
        Night: new Map<string, { quantity: number, total: number }>()
    };

    invoices.forEach(inv => {
        const shift = getShift(new Date(inv.createdAt));
        shiftStats[shift].count++;
        shiftStats[shift].revenue += Number(inv.totalAmount);

        inv.items.forEach(item => {
            const name = item.description;
            let qty = 1;
            const match = name.match(/x(\d+)$/);
            if (match) qty = parseInt(match[1]);

            const current = shiftMedicineMaps[shift].get(name) || { quantity: 0, total: 0 };
            shiftMedicineMaps[shift].set(name, {
                quantity: current.quantity + qty,
                total: current.total + Number(item.amount)
            });
        });
    });

    (Object.keys(shiftStats) as ShiftKey[]).forEach(shift => {
        shiftStats[shift].medicines = Array.from(shiftMedicineMaps[shift].entries()).map(([name, data]) => ({
            name,
            quantity: data.quantity,
            totalAmount: data.total
        }));
    });

    return { daily: dailyStats, shifts: shiftStats };
};
