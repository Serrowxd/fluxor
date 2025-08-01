/**
 * Allocation Service
 * Manages inventory allocation across channels
 */

import { EventBus, DomainEvent } from '../../../../shared/interfaces/module.interface';
import { StockService } from './stock.service';
import { v4 as uuidv4 } from 'uuid';

export interface AllocationRequest {
  productId: string;
  storeId?: string;
  channel?: string;
  channelId?: string;
  quantity: number;
  orderId?: string;
  priority?: number;
}

export interface AllocationResult {
  allocationId: string;
  productId: string;
  channel?: string;
  channelId?: string;
  allocatedQuantity: number;
  status: 'allocated' | 'partial' | 'failed';
  reason?: string;
}

export interface ChannelAllocation {
  channel?: string;
  channelId?: string;
  productId: string;
  quantity: number;
  allocated?: number;
  reserved?: number;
  minLevel?: number;
  maxLevel?: number;
  priority?: number;
}

export class AllocationService {
  private allocations = new Map<string, ChannelAllocation>();

  constructor(
    private stockService: StockService,
    private eventBus: EventBus
  ) {}

  async allocateInventory(request: AllocationRequest): Promise<AllocationResult> {
    const allocationId = uuidv4();
    const channelId = request.channelId || request.channel || 'default';
    const storeId = request.storeId || 'default';
    
    try {
      // Check available stock
      const stockLevel = await this.stockService.getStockLevel(
        request.productId,
        storeId
      );

      if (stockLevel.available < request.quantity) {
        return {
          allocationId,
          productId: request.productId,
          channel: channelId,
          channelId,
          allocatedQuantity: 0,
          status: 'failed',
          reason: 'Insufficient stock'
        };
      }

      // Reserve stock
      await this.stockService.reserveStock(
        request.productId,
        storeId,
        request.quantity,
        allocationId
      );

      // Update channel allocation
      const key = `${channelId}:${request.productId}`;
      const allocation = this.allocations.get(key) || {
        channel: channelId,
        channelId,
        productId: request.productId,
        quantity: 0,
        allocated: 0,
        reserved: 0,
        minLevel: 0,
        maxLevel: 1000,
        priority: request.priority || 5
      };

      allocation.reserved = (allocation.reserved || 0) + request.quantity;
      allocation.quantity = (allocation.allocated || 0) + (allocation.reserved || 0);
      this.allocations.set(key, allocation);

      // Publish allocation event
      await this.publishAllocationEvent('InventoryAllocated', {
        allocationId,
        request,
        result: 'success'
      });

      return {
        allocationId,
        productId: request.productId,
        channel: channelId,
        channelId,
        allocatedQuantity: request.quantity,
        status: 'allocated'
      };
    } catch (error) {
      return {
        allocationId,
        productId: request.productId,
        channel: channelId,
        channelId,
        allocatedQuantity: 0,
        status: 'failed',
        reason: error.message
      };
    }
  }

  async confirmAllocation(allocationId: string, channelId: string, productId: string): Promise<void> {
    const key = `${channelId}:${productId}`;
    const allocation = this.allocations.get(key);
    
    if (!allocation) {
      throw new Error('Allocation not found');
    }

    // Move from reserved to allocated
    allocation.allocated += allocation.reserved;
    allocation.reserved = 0;
    
    this.allocations.set(key, allocation);

    await this.publishAllocationEvent('AllocationConfirmed', {
      allocationId,
      channelId,
      productId,
      allocatedQuantity: allocation.allocated
    });
  }

  async releaseAllocation(
    allocationId: string,
    channelId: string,
    productId: string,
    quantity: number
  ): Promise<void> {
    const key = `${channelId}:${productId}`;
    const allocation = this.allocations.get(key);
    
    if (!allocation) {
      throw new Error('Allocation not found');
    }

    // Release stock back to available
    await this.stockService.releaseStock(
      productId,
      'default', // storeId - would come from config
      quantity,
      allocationId
    );

    // Update allocation
    allocation.reserved = Math.max(0, allocation.reserved - quantity);
    this.allocations.set(key, allocation);

    await this.publishAllocationEvent('AllocationReleased', {
      allocationId,
      channelId,
      productId,
      releasedQuantity: quantity
    });
  }

  async rebalanceAllocations(productId: string): Promise<void> {
    // Get all allocations for the product
    const productAllocations: ChannelAllocation[] = [];
    
    for (const [key, allocation] of this.allocations.entries()) {
      if (allocation.productId === productId) {
        productAllocations.push(allocation);
      }
    }

    // Sort by priority
    productAllocations.sort((a, b) => b.priority - a.priority);

    // Rebalance based on priority and min/max levels
    // This is a simplified implementation
    console.log(`Rebalancing allocations for product ${productId}`);

    await this.publishAllocationEvent('AllocationsRebalanced', {
      productId,
      channelCount: productAllocations.length
    });
  }

  async handleChannelSync(event: DomainEvent): Promise<void> {
    const { channelId, products } = event.data;
    
    for (const product of products) {
      const key = `${channelId}:${product.id}`;
      const allocation = this.allocations.get(key);
      
      if (allocation && allocation.allocated !== product.quantity) {
        // Sync discrepancy detected
        await this.publishAllocationEvent('SyncDiscrepancyDetected', {
          channelId,
          productId: product.id,
          expected: allocation.allocated,
          actual: product.quantity
        });
      }
    }
  }

  private async publishAllocationEvent(eventType: string, data: any): Promise<void> {
    const event: DomainEvent = {
      id: uuidv4(),
      aggregateId: data.productId || data.allocationId,
      aggregateType: 'Allocation',
      eventType,
      eventVersion: 1,
      timestamp: new Date(),
      data
    };

    await this.eventBus.publish(event);
  }

  /**
   * Get channel allocations
   */
  async getChannelAllocations(channel: string): Promise<ChannelAllocation[]> {
    const allocations: ChannelAllocation[] = [];
    
    for (const [key, allocation] of this.allocations.entries()) {
      if (allocation.channel === channel || allocation.channelId === channel) {
        allocations.push(allocation);
      }
    }
    
    return allocations;
  }

  /**
   * Get all allocations for a product
   */
  async getAllAllocations(productId: string): Promise<ChannelAllocation[]> {
    const allocations: ChannelAllocation[] = [];
    
    for (const [key, allocation] of this.allocations.entries()) {
      if (allocation.productId === productId) {
        allocations.push(allocation);
      }
    }
    
    return allocations;
  }

  /**
   * Sync allocations across channels
   */
  async syncAllocations(productId: string): Promise<{
    synced: boolean;
    channels: string[];
    totalAllocated: number;
  }> {
    const allocations = await this.getAllAllocations(productId);
    const totalAllocated = allocations.reduce((sum, a) => sum + (a.allocated || 0), 0);
    const channels = allocations.map(a => a.channel || a.channelId || 'unknown');
    
    // Publish sync event
    await this.publishAllocationEvent('AllocationsSynced', {
      productId,
      channels,
      totalAllocated
    });
    
    return {
      synced: true,
      channels,
      totalAllocated
    };
  }

  isReady(): boolean {
    return true;
  }
}