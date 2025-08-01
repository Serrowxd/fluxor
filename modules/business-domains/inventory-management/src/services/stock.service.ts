/**
 * Stock Service
 * Manages inventory stock levels and movements
 */

import { EventBus, DomainEvent } from '../../../../shared/interfaces/module.interface';
import { v4 as uuidv4 } from 'uuid';

export interface StockLevel {
  productId: string;
  storeId?: string;
  quantity: number;
  available: number;
  reserved: number;
  total?: number;
  lowStockThreshold?: number;
  lastUpdated?: Date;
  previousQuantity?: number;
}

export interface StockMovement {
  productId: string;
  storeId: string;
  quantity: number;
  type: 'IN' | 'OUT' | 'RESERVE' | 'RELEASE';
  reason: string;
  referenceId?: string;
}

export class StockService {
  private stockLevels = new Map<string, StockLevel>();
  private defaultStore = 'default';

  constructor(private eventBus: EventBus) {}

  async getStockLevel(productId: string, storeId: string): Promise<StockLevel> {
    const key = `${storeId}:${productId}`;
    const stock = this.stockLevels.get(key);
    
    if (!stock) {
      return {
        productId,
        storeId,
        available: 0,
        reserved: 0,
        total: 0
      };
    }
    
    return { ...stock };
  }

  async checkAvailability(
    productId: string,
    storeId: string,
    quantity: number
  ): Promise<boolean> {
    const stock = await this.getStockLevel(productId, storeId);
    return stock.available >= quantity;
  }


  async adjustStock(movement: StockMovement): Promise<void> {
    const key = `${movement.storeId}:${movement.productId}`;
    const stock = await this.getStockLevel(movement.productId, movement.storeId);

    switch (movement.type) {
      case 'IN':
        stock.total += movement.quantity;
        stock.available += movement.quantity;
        break;
      case 'OUT':
        if (stock.available < movement.quantity) {
          throw new Error('Insufficient available stock');
        }
        stock.total -= movement.quantity;
        stock.available -= movement.quantity;
        break;
      case 'RESERVE':
        await this.reserveStock(
          movement.productId,
          movement.storeId,
          movement.quantity,
          movement.referenceId || ''
        );
        return;
      case 'RELEASE':
        await this.releaseStock(
          movement.productId,
          movement.storeId,
          movement.quantity,
          movement.referenceId || ''
        );
        return;
    }

    this.stockLevels.set(key, stock);

    // Publish event
    await this.publishStockEvent('StockLevelChanged', {
      productId: movement.productId,
      storeId: movement.storeId,
      movement,
      newLevel: stock
    });
  }

  private async publishStockEvent(eventType: string, data: any): Promise<void> {
    const event: DomainEvent = {
      id: uuidv4(),
      aggregateId: data.productId,
      aggregateType: 'Product',
      eventType,
      eventVersion: 1,
      timestamp: new Date(),
      data
    };

    await this.eventBus.publish(event);
  }

  /**
   * Get stock for a product (simplified interface without storeId)
   */
  async getStock(productId: string): Promise<StockLevel> {
    const stock = await this.getStockLevel(productId, this.defaultStore);
    return {
      ...stock,
      quantity: stock.total || stock.available + stock.reserved,
      lastUpdated: new Date()
    };
  }

  /**
   * Update stock quantity
   */
  async updateStock(productId: string, quantity: number): Promise<StockLevel> {
    const currentStock = await this.getStock(productId);
    const previousQuantity = currentStock.quantity;
    const key = `${this.defaultStore}:${productId}`;
    
    const newStock: StockLevel = {
      ...currentStock,
      quantity,
      available: quantity - currentStock.reserved,
      total: quantity,
      previousQuantity,
      lastUpdated: new Date()
    };

    if (newStock.available < 0) {
      throw new Error('Cannot set quantity less than reserved amount');
    }

    this.stockLevels.set(key, newStock);

    // Publish event
    await this.publishStockEvent('StockUpdated', {
      productId,
      previousQuantity,
      newQuantity: quantity,
      stock: newStock
    });

    return newStock;
  }

  /**
   * Reserve stock (simplified interface overload)
   */
  async reserveStock(productId: string, quantity: number, orderId: string): Promise<StockLevel>;
  async reserveStock(productId: string, storeId: string, quantity: number, referenceId: string): Promise<void>;
  async reserveStock(
    productId: string, 
    quantityOrStoreId: number | string, 
    orderIdOrQuantity: string | number,
    referenceId?: string
  ): Promise<StockLevel | void> {
    if (typeof quantityOrStoreId === 'number') {
      // Simple interface: productId, quantity, orderId
      const quantity = quantityOrStoreId;
      const orderId = orderIdOrQuantity as string;
      const key = `${this.defaultStore}:${productId}`;
      const stock = await this.getStockLevel(productId, this.defaultStore);
      
      if (stock.available < quantity) {
        throw new Error(`Insufficient stock. Available: ${stock.available}, Requested: ${quantity}`);
      }

      // Update stock levels
      stock.available -= quantity;
      stock.reserved += quantity;
      stock.quantity = stock.available + stock.reserved;
      stock.lastUpdated = new Date();
      this.stockLevels.set(key, stock);

      // Publish event
      await this.publishStockEvent('StockReserved', {
        productId,
        storeId: this.defaultStore,
        quantity,
        referenceId: orderId,
        newAvailable: stock.available,
        newReserved: stock.reserved
      });

      return stock;
    } else {
      // Original interface: productId, storeId, quantity, referenceId
      const storeId = quantityOrStoreId;
      const quantity = orderIdOrQuantity as number;
      const key = `${storeId}:${productId}`;
      const stock = await this.getStockLevel(productId, storeId);
      
      if (stock.available < quantity) {
        throw new Error(`Insufficient stock. Available: ${stock.available}, Requested: ${quantity}`);
      }

      // Update stock levels
      stock.available -= quantity;
      stock.reserved += quantity;
      this.stockLevels.set(key, stock);

      // Publish event
      await this.publishStockEvent('StockReserved', {
        productId,
        storeId,
        quantity,
        referenceId,
        newAvailable: stock.available,
        newReserved: stock.reserved
      });
    }
  }

  /**
   * Release stock (simplified interface overload)
   */
  async releaseStock(productId: string, quantity: number, orderId: string): Promise<StockLevel>;
  async releaseStock(productId: string, storeId: string, quantity: number, referenceId: string): Promise<void>;
  async releaseStock(
    productId: string,
    quantityOrStoreId: number | string,
    orderIdOrQuantity: string | number,
    referenceId?: string
  ): Promise<StockLevel | void> {
    if (typeof quantityOrStoreId === 'number') {
      // Simple interface: productId, quantity, orderId
      const quantity = quantityOrStoreId;
      const orderId = orderIdOrQuantity as string;
      const key = `${this.defaultStore}:${productId}`;
      const stock = await this.getStockLevel(productId, this.defaultStore);
      
      if (stock.reserved < quantity) {
        throw new Error(`Cannot release more than reserved. Reserved: ${stock.reserved}, Requested: ${quantity}`);
      }

      // Update stock levels
      stock.available += quantity;
      stock.reserved -= quantity;
      stock.quantity = stock.available + stock.reserved;
      stock.lastUpdated = new Date();
      this.stockLevels.set(key, stock);

      // Publish event
      await this.publishStockEvent('StockReleased', {
        productId,
        storeId: this.defaultStore,
        quantity,
        referenceId: orderId,
        newAvailable: stock.available,
        newReserved: stock.reserved
      });

      return stock;
    } else {
      // Original interface: productId, storeId, quantity, referenceId
      const storeId = quantityOrStoreId;
      const quantity = orderIdOrQuantity as number;
      const key = `${storeId}:${productId}`;
      const stock = await this.getStockLevel(productId, storeId);
      
      if (stock.reserved < quantity) {
        throw new Error(`Cannot release more than reserved. Reserved: ${stock.reserved}, Requested: ${quantity}`);
      }

      // Update stock levels
      stock.available += quantity;
      stock.reserved -= quantity;
      this.stockLevels.set(key, stock);

      // Publish event
      await this.publishStockEvent('StockReleased', {
        productId,
        storeId,
        quantity,
        referenceId,
        newAvailable: stock.available,
        newReserved: stock.reserved
      });
    }
  }

  /**
   * Get low stock products
   */
  async getLowStockProducts(): Promise<Array<{
    productId: string;
    quantity: number;
    available: number;
    threshold: number;
  }>> {
    const lowStockProducts = [];
    
    for (const [key, stock] of this.stockLevels) {
      if (stock.lowStockThreshold && stock.quantity <= stock.lowStockThreshold) {
        lowStockProducts.push({
          productId: stock.productId,
          quantity: stock.quantity,
          available: stock.available,
          threshold: stock.lowStockThreshold
        });
      }
    }

    return lowStockProducts;
  }

  /**
   * Set low stock threshold
   */
  async setLowStockThreshold(productId: string, threshold: number): Promise<void> {
    const stock = await this.getStock(productId);
    const key = `${this.defaultStore}:${productId}`;
    
    this.stockLevels.set(key, {
      ...stock,
      lowStockThreshold: threshold
    });

    // Check if now below threshold
    if (stock.quantity <= threshold) {
      await this.publishStockEvent('LowStockAlert', {
        productId,
        currentQuantity: stock.quantity,
        threshold,
        available: stock.available
      });
    }
  }

  isReady(): boolean {
    return true;
  }
}