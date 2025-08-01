/**
 * Inventory Controller
 * HTTP endpoint handlers for inventory operations
 */

import { Request, Response, Router } from 'express';
import { StockService } from '../services/stock.service';
import { AllocationService } from '../services/allocation.service';
import { InventoryTrackingService } from '../services/inventory-tracking.service';
import { InventorySaga } from '../sagas/inventory.saga';

export class InventoryController {
  private router: Router;
  private stockService: StockService;
  private allocationService: AllocationService;
  private trackingService: InventoryTrackingService;
  private inventorySaga: InventorySaga;

  constructor(
    stockService: StockService,
    allocationService: AllocationService,
    trackingService: InventoryTrackingService,
    inventorySaga: InventorySaga
  ) {
    this.stockService = stockService;
    this.allocationService = allocationService;
    this.trackingService = trackingService;
    this.inventorySaga = inventorySaga;
    this.router = Router();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Stock management routes
    this.router.get('/stock/:productId', this.getStock.bind(this));
    this.router.post('/stock/:productId/update', this.updateStock.bind(this));
    this.router.post('/stock/:productId/reserve', this.reserveStock.bind(this));
    this.router.post('/stock/:productId/release', this.releaseStock.bind(this));
    this.router.post('/stock/bulk-update', this.bulkUpdateStock.bind(this));

    // Allocation routes
    this.router.post('/allocate', this.allocateInventory.bind(this));
    this.router.get('/allocations/:channel', this.getChannelAllocations.bind(this));
    this.router.post('/allocations/sync', this.syncAllocations.bind(this));

    // Tracking routes
    this.router.get('/movements/:productId', this.getMovementHistory.bind(this));
    this.router.get('/snapshots/:productId', this.getSnapshots.bind(this));
    this.router.get('/turnover/:productId', this.getTurnover.bind(this));
    this.router.get('/audit/:productId', this.getAuditTrail.bind(this));
    this.router.get('/anomalies/:productId', this.detectAnomalies.bind(this));

    // Analytics routes
    this.router.get('/analytics/low-stock', this.getLowStockProducts.bind(this));
    this.router.get('/analytics/valuation', this.getInventoryValuation.bind(this));
  }

  /**
   * Get stock levels for a product
   */
  private async getStock(req: Request, res: Response): Promise<void> {
    try {
      const { productId } = req.params;
      const stock = await this.stockService.getStock(productId);
      
      if (!stock) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }

      res.json({
        productId: stock.productId,
        quantity: stock.quantity,
        available: stock.available,
        reserved: stock.reserved,
        lowStockThreshold: stock.lowStockThreshold,
        lastUpdated: stock.lastUpdated
      });
    } catch (error) {
      console.error('Error getting stock:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Update stock quantity
   */
  private async updateStock(req: Request, res: Response): Promise<void> {
    try {
      const { productId } = req.params;
      const { quantity, reason, userId } = req.body;

      if (typeof quantity !== 'number' || quantity < 0) {
        res.status(400).json({ error: 'Invalid quantity' });
        return;
      }

      const result = await this.stockService.updateStock(productId, quantity);

      // Record movement
      await this.trackingService.recordMovement({
        productId,
        type: 'ADJUSTMENT',
        quantity: quantity - (result.previousQuantity || 0),
        reason: reason || 'Manual stock update',
        userId
      });

      res.json({
        success: true,
        stock: result
      });
    } catch (error) {
      console.error('Error updating stock:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Reserve stock
   */
  private async reserveStock(req: Request, res: Response): Promise<void> {
    try {
      const { productId } = req.params;
      const { quantity, orderId, userId } = req.body;

      if (typeof quantity !== 'number' || quantity <= 0) {
        res.status(400).json({ error: 'Invalid quantity' });
        return;
      }

      const result = await this.stockService.reserveStock(productId, quantity, orderId);

      // Record movement
      await this.trackingService.recordMovement({
        productId,
        type: 'OUT',
        quantity,
        reason: 'Stock reservation',
        reference: orderId,
        userId
      });

      res.json({
        success: true,
        stock: result
      });
    } catch (error) {
      console.error('Error reserving stock:', error);
      if (error.message?.includes('Insufficient stock')) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * Release reserved stock
   */
  private async releaseStock(req: Request, res: Response): Promise<void> {
    try {
      const { productId } = req.params;
      const { quantity, orderId, userId } = req.body;

      if (typeof quantity !== 'number' || quantity <= 0) {
        res.status(400).json({ error: 'Invalid quantity' });
        return;
      }

      const result = await this.stockService.releaseStock(productId, quantity, orderId);

      // Record movement
      await this.trackingService.recordMovement({
        productId,
        type: 'IN',
        quantity,
        reason: 'Stock release',
        reference: orderId,
        userId
      });

      res.json({
        success: true,
        stock: result
      });
    } catch (error) {
      console.error('Error releasing stock:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Bulk update stock levels
   */
  private async bulkUpdateStock(req: Request, res: Response): Promise<void> {
    try {
      const { updates, reason, userId } = req.body;

      if (!Array.isArray(updates)) {
        res.status(400).json({ error: 'Updates must be an array' });
        return;
      }

      const results = [];
      const errors = [];

      for (const update of updates) {
        try {
          const result = await this.stockService.updateStock(update.productId, update.quantity);
          
          // Record movement
          await this.trackingService.recordMovement({
            productId: update.productId,
            type: 'ADJUSTMENT',
            quantity: update.quantity - (result.previousQuantity || 0),
            reason: reason || 'Bulk stock update',
            userId
          });

          results.push({ productId: update.productId, success: true, stock: result });
        } catch (error) {
          errors.push({ productId: update.productId, error: error.message });
        }
      }

      res.json({
        results,
        errors,
        summary: {
          total: updates.length,
          successful: results.length,
          failed: errors.length
        }
      });
    } catch (error) {
      console.error('Error in bulk update:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Allocate inventory to channels
   */
  private async allocateInventory(req: Request, res: Response): Promise<void> {
    try {
      const { productId, channel, quantity, priority } = req.body;

      const allocation = await this.allocationService.allocateInventory({
        productId,
        channel,
        quantity,
        priority: priority || 0
      });

      res.json({
        success: true,
        allocation
      });
    } catch (error) {
      console.error('Error allocating inventory:', error);
      if (error.message?.includes('Insufficient')) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  /**
   * Get channel allocations
   */
  private async getChannelAllocations(req: Request, res: Response): Promise<void> {
    try {
      const { channel } = req.params;
      const allocations = await this.allocationService.getChannelAllocations(channel);

      res.json({
        channel,
        allocations
      });
    } catch (error) {
      console.error('Error getting channel allocations:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Sync allocations across channels
   */
  private async syncAllocations(req: Request, res: Response): Promise<void> {
    try {
      const { productId } = req.body;
      const result = await this.allocationService.syncAllocations(productId);

      res.json({
        success: true,
        result
      });
    } catch (error) {
      console.error('Error syncing allocations:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get movement history
   */
  private async getMovementHistory(req: Request, res: Response): Promise<void> {
    try {
      const { productId } = req.params;
      const { startDate, endDate, type, limit } = req.query;

      const movements = await this.trackingService.getMovementHistory(productId, {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        type: type as any,
        limit: limit ? parseInt(limit as string) : undefined
      });

      res.json({
        productId,
        movements,
        count: movements.length
      });
    } catch (error) {
      console.error('Error getting movement history:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get inventory snapshots
   */
  private async getSnapshots(req: Request, res: Response): Promise<void> {
    try {
      const { productId } = req.params;
      const { startDate, endDate, limit } = req.query;

      const snapshots = await this.trackingService.getSnapshots(productId, {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined
      });

      res.json({
        productId,
        snapshots,
        count: snapshots.length
      });
    } catch (error) {
      console.error('Error getting snapshots:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get inventory turnover
   */
  private async getTurnover(req: Request, res: Response): Promise<void> {
    try {
      const { productId } = req.params;
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'Start date and end date are required' });
        return;
      }

      const turnover = await this.trackingService.calculateTurnover(productId, {
        startDate: new Date(startDate as string),
        endDate: new Date(endDate as string)
      });

      res.json({
        productId,
        period: { startDate, endDate },
        turnover
      });
    } catch (error) {
      console.error('Error calculating turnover:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get audit trail
   */
  private async getAuditTrail(req: Request, res: Response): Promise<void> {
    try {
      const { productId } = req.params;
      const { startDate, endDate, userId } = req.query;

      const auditTrail = await this.trackingService.getAuditTrail(productId, {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        userId: userId as string
      });

      res.json({
        productId,
        auditTrail,
        count: auditTrail.length
      });
    } catch (error) {
      console.error('Error getting audit trail:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Detect anomalies
   */
  private async detectAnomalies(req: Request, res: Response): Promise<void> {
    try {
      const { productId } = req.params;
      const anomalies = await this.trackingService.detectAnomalies(productId);

      res.json({
        productId,
        anomalies,
        count: anomalies.length
      });
    } catch (error) {
      console.error('Error detecting anomalies:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get low stock products
   */
  private async getLowStockProducts(req: Request, res: Response): Promise<void> {
    try {
      const products = await this.stockService.getLowStockProducts();
      
      res.json({
        products,
        count: products.length
      });
    } catch (error) {
      console.error('Error getting low stock products:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get inventory valuation
   */
  private async getInventoryValuation(req: Request, res: Response): Promise<void> {
    try {
      const { productId, costPerUnit } = req.query;

      if (!productId || !costPerUnit) {
        res.status(400).json({ error: 'Product ID and cost per unit are required' });
        return;
      }

      const valuation = await this.trackingService.getValuationHistory(
        productId as string,
        parseFloat(costPerUnit as string)
      );

      res.json({
        productId,
        costPerUnit,
        valuation
      });
    } catch (error) {
      console.error('Error getting inventory valuation:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  getRouter(): Router {
    return this.router;
  }
}