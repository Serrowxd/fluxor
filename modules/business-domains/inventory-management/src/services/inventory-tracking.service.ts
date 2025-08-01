/**
 * Inventory Tracking Service
 * Tracks inventory movements, history, and provides audit trail
 */

import { EventBusService } from '../../../../core-platform/event-bus/src/event-bus.service';
import { DomainEvent } from '../../../../shared/interfaces/event.interface';

export interface InventoryMovement {
  id: string;
  productId: string;
  type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER';
  quantity: number;
  fromLocation?: string;
  toLocation?: string;
  reason: string;
  reference?: string;
  timestamp: Date;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface InventorySnapshot {
  productId: string;
  quantity: number;
  available: number;
  reserved: number;
  timestamp: Date;
  location?: string;
}

export class InventoryTrackingService {
  private movements: Map<string, InventoryMovement[]> = new Map();
  private snapshots: Map<string, InventorySnapshot[]> = new Map();
  private eventBus: EventBusService;

  constructor(eventBus: EventBusService) {
    this.eventBus = eventBus;
  }

  /**
   * Record an inventory movement
   */
  async recordMovement(movement: Omit<InventoryMovement, 'id' | 'timestamp'>): Promise<InventoryMovement> {
    const fullMovement: InventoryMovement = {
      ...movement,
      id: this.generateId(),
      timestamp: new Date()
    };

    // Store movement
    const productMovements = this.movements.get(movement.productId) || [];
    productMovements.push(fullMovement);
    this.movements.set(movement.productId, productMovements);

    // Publish event
    await this.eventBus.publish({
      eventType: 'InventoryMovementRecorded',
      aggregateId: movement.productId,
      aggregateType: 'Inventory',
      payload: fullMovement,
      metadata: {
        userId: movement.userId,
        timestamp: fullMovement.timestamp.toISOString()
      }
    });

    return fullMovement;
  }

  /**
   * Take a snapshot of current inventory levels
   */
  async takeSnapshot(productId: string, currentLevels: Omit<InventorySnapshot, 'timestamp'>): Promise<InventorySnapshot> {
    const snapshot: InventorySnapshot = {
      ...currentLevels,
      timestamp: new Date()
    };

    const productSnapshots = this.snapshots.get(productId) || [];
    productSnapshots.push(snapshot);
    this.snapshots.set(productId, productSnapshots);

    return snapshot;
  }

  /**
   * Get movement history for a product
   */
  async getMovementHistory(
    productId: string, 
    options?: {
      startDate?: Date;
      endDate?: Date;
      type?: InventoryMovement['type'];
      limit?: number;
    }
  ): Promise<InventoryMovement[]> {
    const movements = this.movements.get(productId) || [];
    
    let filtered = movements;

    if (options?.startDate) {
      filtered = filtered.filter(m => m.timestamp >= options.startDate!);
    }

    if (options?.endDate) {
      filtered = filtered.filter(m => m.timestamp <= options.endDate!);
    }

    if (options?.type) {
      filtered = filtered.filter(m => m.type === options.type);
    }

    // Sort by timestamp descending
    filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (options?.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * Get inventory snapshots
   */
  async getSnapshots(
    productId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    }
  ): Promise<InventorySnapshot[]> {
    const snapshots = this.snapshots.get(productId) || [];
    
    let filtered = snapshots;

    if (options?.startDate) {
      filtered = filtered.filter(s => s.timestamp >= options.startDate!);
    }

    if (options?.endDate) {
      filtered = filtered.filter(s => s.timestamp <= options.endDate!);
    }

    // Sort by timestamp descending
    filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (options?.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * Calculate inventory turnover for a product
   */
  async calculateTurnover(
    productId: string,
    period: { startDate: Date; endDate: Date }
  ): Promise<{
    turnoverRatio: number;
    averageInventory: number;
    totalOutflow: number;
    daysInPeriod: number;
  }> {
    const movements = await this.getMovementHistory(productId, period);
    const snapshots = await this.getSnapshots(productId, period);

    // Calculate total outflow
    const totalOutflow = movements
      .filter(m => m.type === 'OUT')
      .reduce((sum, m) => sum + m.quantity, 0);

    // Calculate average inventory from snapshots
    const averageInventory = snapshots.length > 0
      ? snapshots.reduce((sum, s) => sum + s.quantity, 0) / snapshots.length
      : 0;

    // Calculate days in period
    const daysInPeriod = Math.ceil(
      (period.endDate.getTime() - period.startDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Calculate turnover ratio
    const turnoverRatio = averageInventory > 0 
      ? (totalOutflow / averageInventory) * (365 / daysInPeriod)
      : 0;

    return {
      turnoverRatio,
      averageInventory,
      totalOutflow,
      daysInPeriod
    };
  }

  /**
   * Get inventory valuation history
   */
  async getValuationHistory(
    productId: string,
    costPerUnit: number,
    options?: {
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<Array<{
    date: Date;
    quantity: number;
    value: number;
  }>> {
    const snapshots = await this.getSnapshots(productId, options);
    
    return snapshots.map(snapshot => ({
      date: snapshot.timestamp,
      quantity: snapshot.quantity,
      value: snapshot.quantity * costPerUnit
    }));
  }

  /**
   * Audit trail for compliance
   */
  async getAuditTrail(
    productId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      userId?: string;
    }
  ): Promise<Array<{
    timestamp: Date;
    action: string;
    userId?: string;
    details: any;
  }>> {
    const movements = await this.getMovementHistory(productId, options);
    
    const auditEntries = movements.map(movement => ({
      timestamp: movement.timestamp,
      action: `INVENTORY_${movement.type}`,
      userId: movement.userId,
      details: {
        quantity: movement.quantity,
        reason: movement.reason,
        reference: movement.reference,
        fromLocation: movement.fromLocation,
        toLocation: movement.toLocation,
        metadata: movement.metadata
      }
    }));

    if (options?.userId) {
      return auditEntries.filter(entry => entry.userId === options.userId);
    }

    return auditEntries;
  }

  /**
   * Detect anomalies in inventory movements
   */
  async detectAnomalies(productId: string): Promise<Array<{
    type: string;
    severity: 'low' | 'medium' | 'high';
    description: string;
    timestamp: Date;
    data: any;
  }>> {
    const anomalies = [];
    const movements = await this.getMovementHistory(productId, {
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
    });

    // Check for unusual large movements
    const quantities = movements.map(m => m.quantity);
    if (quantities.length > 0) {
      const avg = quantities.reduce((a, b) => a + b, 0) / quantities.length;
      const stdDev = Math.sqrt(
        quantities.reduce((sum, q) => sum + Math.pow(q - avg, 2), 0) / quantities.length
      );

      movements.forEach(movement => {
        if (movement.quantity > avg + (2 * stdDev)) {
          anomalies.push({
            type: 'LARGE_MOVEMENT',
            severity: 'medium' as const,
            description: `Unusually large ${movement.type} movement detected`,
            timestamp: movement.timestamp,
            data: { movement, average: avg, standardDeviation: stdDev }
          });
        }
      });
    }

    // Check for frequent adjustments
    const adjustments = movements.filter(m => m.type === 'ADJUSTMENT');
    if (adjustments.length > movements.length * 0.3) {
      anomalies.push({
        type: 'FREQUENT_ADJUSTMENTS',
        severity: 'high' as const,
        description: 'High frequency of inventory adjustments detected',
        timestamp: new Date(),
        data: { 
          adjustmentCount: adjustments.length, 
          totalMovements: movements.length,
          percentage: (adjustments.length / movements.length) * 100
        }
      });
    }

    return anomalies;
  }

  private generateId(): string {
    return `MOV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  isReady(): boolean {
    return true;
  }
}