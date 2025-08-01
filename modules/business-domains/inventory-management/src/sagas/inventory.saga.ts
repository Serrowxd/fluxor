/**
 * Inventory Saga
 * Orchestrates complex inventory operations with compensation logic
 */

import { StockService } from '../services/stock.service';
import { AllocationService } from '../services/allocation.service';
import { EventBusService } from '../../../../core-platform/event-bus/src/event-bus.service';
import { DomainEvent } from '../../../../shared/interfaces/event.interface';

export interface SagaStep {
  name: string;
  action: () => Promise<any>;
  compensate: (result: any) => Promise<void>;
}

export interface SagaResult {
  success: boolean;
  results: any[];
  error?: Error;
  compensatedSteps?: string[];
}

export class InventorySaga {
  private stockService: StockService;
  private allocationService: AllocationService;
  private eventBus: EventBusService;

  constructor(
    stockService: StockService,
    allocationService: AllocationService,
    eventBus: EventBusService
  ) {
    this.stockService = stockService;
    this.allocationService = allocationService;
    this.eventBus = eventBus;
  }

  /**
   * Handle order created event - reserve inventory across products
   */
  async handleOrderCreated(event: DomainEvent): Promise<void> {
    const order = event.payload;
    const orderItems = order.items || [];

    const saga = this.createOrderInventorySaga(order.id, orderItems);
    const result = await this.executeSaga(saga);

    if (result.success) {
      await this.eventBus.publish({
        eventType: 'InventoryReservedForOrder',
        aggregateId: order.id,
        aggregateType: 'Order',
        payload: {
          orderId: order.id,
          reservations: result.results
        },
        metadata: {
          timestamp: new Date().toISOString()
        }
      });
    } else {
      await this.eventBus.publish({
        eventType: 'InventoryReservationFailed',
        aggregateId: order.id,
        aggregateType: 'Order',
        payload: {
          orderId: order.id,
          error: result.error?.message,
          compensatedSteps: result.compensatedSteps
        },
        metadata: {
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  /**
   * Create saga for order inventory reservation
   */
  private createOrderInventorySaga(orderId: string, items: any[]): SagaStep[] {
    return items.map((item, index) => ({
      name: `Reserve inventory for item ${index + 1}`,
      action: async () => {
        const result = await this.stockService.reserveStock(
          item.productId,
          item.quantity,
          orderId
        );
        return { productId: item.productId, quantity: item.quantity, result };
      },
      compensate: async (stepResult) => {
        if (stepResult) {
          await this.stockService.releaseStock(
            stepResult.productId,
            stepResult.quantity,
            orderId
          );
        }
      }
    }));
  }

  /**
   * Handle bulk inventory transfer between locations
   */
  async executeBulkTransfer(transfers: Array<{
    productId: string;
    quantity: number;
    fromLocation: string;
    toLocation: string;
  }>): Promise<SagaResult> {
    const saga = this.createBulkTransferSaga(transfers);
    return await this.executeSaga(saga);
  }

  /**
   * Create saga for bulk transfers
   */
  private createBulkTransferSaga(transfers: any[]): SagaStep[] {
    const steps: SagaStep[] = [];

    transfers.forEach((transfer, index) => {
      // Step 1: Remove from source location
      steps.push({
        name: `Remove ${transfer.quantity} of ${transfer.productId} from ${transfer.fromLocation}`,
        action: async () => {
          // In a real implementation, this would update location-specific stock
          const stock = await this.stockService.getStock(transfer.productId);
          if (stock.available < transfer.quantity) {
            throw new Error(`Insufficient stock at ${transfer.fromLocation}`);
          }
          // Temporarily reduce stock
          await this.stockService.updateStock(
            transfer.productId,
            stock.quantity - transfer.quantity
          );
          return { 
            productId: transfer.productId, 
            quantity: transfer.quantity,
            previousQuantity: stock.quantity
          };
        },
        compensate: async (result) => {
          if (result) {
            await this.stockService.updateStock(
              result.productId,
              result.previousQuantity
            );
          }
        }
      });

      // Step 2: Add to destination location
      steps.push({
        name: `Add ${transfer.quantity} of ${transfer.productId} to ${transfer.toLocation}`,
        action: async () => {
          const stock = await this.stockService.getStock(transfer.productId);
          await this.stockService.updateStock(
            transfer.productId,
            stock.quantity + transfer.quantity
          );
          return { 
            productId: transfer.productId, 
            quantity: transfer.quantity,
            previousQuantity: stock.quantity
          };
        },
        compensate: async (result) => {
          if (result) {
            await this.stockService.updateStock(
              result.productId,
              result.previousQuantity
            );
          }
        }
      });
    });

    return steps;
  }

  /**
   * Handle multi-channel allocation with priority
   */
  async executeMultiChannelAllocation(
    productId: string,
    allocations: Array<{
      channel: string;
      requestedQuantity: number;
      priority: number;
    }>
  ): Promise<SagaResult> {
    // Sort by priority (higher priority first)
    const sortedAllocations = [...allocations].sort((a, b) => b.priority - a.priority);
    const saga = this.createMultiChannelAllocationSaga(productId, sortedAllocations);
    return await this.executeSaga(saga);
  }

  /**
   * Create saga for multi-channel allocation
   */
  private createMultiChannelAllocationSaga(productId: string, allocations: any[]): SagaStep[] {
    return allocations.map((allocation) => ({
      name: `Allocate ${allocation.requestedQuantity} to ${allocation.channel}`,
      action: async () => {
        const result = await this.allocationService.allocateInventory({
          productId,
          channel: allocation.channel,
          quantity: allocation.requestedQuantity,
          priority: allocation.priority
        });
        return result;
      },
      compensate: async (allocationResult) => {
        if (allocationResult) {
          // Release the allocation
          const stock = await this.stockService.getStock(productId);
          await this.stockService.releaseStock(
            productId,
            allocationResult.allocatedQuantity,
            `allocation-${allocationResult.channel}`
          );
        }
      }
    }));
  }

  /**
   * Execute inventory rebalancing across channels
   */
  async executeInventoryRebalancing(productId: string): Promise<SagaResult> {
    const allocations = await this.allocationService.getAllAllocations(productId);
    const stock = await this.stockService.getStock(productId);
    
    // Calculate optimal distribution
    const totalAllocated = allocations.reduce((sum, a) => sum + a.quantity, 0);
    const averageAllocation = Math.floor(stock.available / allocations.length);
    
    const rebalanceSteps: SagaStep[] = [];
    
    // Create rebalancing steps
    allocations.forEach((allocation) => {
      const difference = averageAllocation - allocation.quantity;
      
      if (difference !== 0) {
        rebalanceSteps.push({
          name: `Rebalance ${allocation.channel} from ${allocation.quantity} to ${averageAllocation}`,
          action: async () => {
            // Update allocation
            const newAllocation = await this.allocationService.allocateInventory({
              productId,
              channel: allocation.channel,
              quantity: averageAllocation,
              priority: allocation.priority || 0
            });
            return { 
              channel: allocation.channel, 
              oldQuantity: allocation.quantity,
              newQuantity: averageAllocation,
              result: newAllocation
            };
          },
          compensate: async (result) => {
            if (result) {
              // Restore original allocation
              await this.allocationService.allocateInventory({
                productId,
                channel: result.channel,
                quantity: result.oldQuantity,
                priority: 0
              });
            }
          }
        });
      }
    });
    
    return await this.executeSaga(rebalanceSteps);
  }

  /**
   * Generic saga executor with compensation support
   */
  private async executeSaga(steps: SagaStep[]): Promise<SagaResult> {
    const executedSteps: Array<{ step: SagaStep; result: any }> = [];
    
    try {
      // Execute all steps
      for (const step of steps) {
        console.log(`Executing saga step: ${step.name}`);
        const result = await step.action();
        executedSteps.push({ step, result });
      }
      
      // All steps successful
      return {
        success: true,
        results: executedSteps.map(e => e.result)
      };
    } catch (error) {
      console.error('Saga failed, starting compensation:', error);
      
      // Compensate in reverse order
      const compensatedSteps: string[] = [];
      for (const executed of executedSteps.reverse()) {
        try {
          console.log(`Compensating: ${executed.step.name}`);
          await executed.step.compensate(executed.result);
          compensatedSteps.push(executed.step.name);
        } catch (compensationError) {
          console.error(`Compensation failed for ${executed.step.name}:`, compensationError);
          // Continue with other compensations
        }
      }
      
      return {
        success: false,
        results: [],
        error: error as Error,
        compensatedSteps
      };
    }
  }

  /**
   * Handle complex order fulfillment with partial shipments
   */
  async executeOrderFulfillment(
    orderId: string,
    fulfillments: Array<{
      productId: string;
      quantity: number;
      warehouseId: string;
    }>
  ): Promise<SagaResult> {
    const saga: SagaStep[] = [];

    // Step 1: Validate all items can be fulfilled
    saga.push({
      name: 'Validate fulfillment feasibility',
      action: async () => {
        const validations = await Promise.all(
          fulfillments.map(async (f) => {
            const stock = await this.stockService.getStock(f.productId);
            return {
              productId: f.productId,
              canFulfill: stock.reserved >= f.quantity,
              available: stock.reserved
            };
          })
        );
        
        const cannotFulfill = validations.filter(v => !v.canFulfill);
        if (cannotFulfill.length > 0) {
          throw new Error(`Cannot fulfill items: ${cannotFulfill.map(v => v.productId).join(', ')}`);
        }
        
        return validations;
      },
      compensate: async () => {
        // No compensation needed for validation
      }
    });

    // Step 2: Convert reservations to actual stock deductions
    fulfillments.forEach((fulfillment) => {
      saga.push({
        name: `Fulfill ${fulfillment.quantity} of ${fulfillment.productId} from ${fulfillment.warehouseId}`,
        action: async () => {
          // Get current stock
          const stock = await this.stockService.getStock(fulfillment.productId);
          
          // Update stock levels
          const newQuantity = stock.quantity - fulfillment.quantity;
          const newReserved = stock.reserved - fulfillment.quantity;
          
          await this.stockService.updateStock(fulfillment.productId, newQuantity);
          
          // Publish fulfillment event
          await this.eventBus.publish({
            eventType: 'InventoryFulfilled',
            aggregateId: fulfillment.productId,
            aggregateType: 'Inventory',
            payload: {
              orderId,
              productId: fulfillment.productId,
              quantity: fulfillment.quantity,
              warehouseId: fulfillment.warehouseId
            },
            metadata: {
              timestamp: new Date().toISOString()
            }
          });
          
          return {
            productId: fulfillment.productId,
            previousQuantity: stock.quantity,
            previousReserved: stock.reserved,
            fulfilledQuantity: fulfillment.quantity
          };
        },
        compensate: async (result) => {
          if (result) {
            // Restore stock levels
            await this.stockService.updateStock(
              result.productId,
              result.previousQuantity
            );
            
            // Restore reservation
            await this.stockService.reserveStock(
              result.productId,
              result.fulfilledQuantity,
              orderId
            );
          }
        }
      });
    });

    return await this.executeSaga(saga);
  }
}