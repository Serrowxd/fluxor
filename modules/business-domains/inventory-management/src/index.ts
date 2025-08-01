/**
 * Inventory Management Module
 * Handles all inventory-related business logic
 */

import { Module, ModuleConfig, ModuleExports, HealthCheckResult } from '../../../shared/interfaces/module.interface';
import { StockService } from './services/stock.service';
import { AllocationService } from './services/allocation.service';
import { InventoryTrackingService } from './services/inventory-tracking.service';
import { InventoryController } from './controllers/inventory.controller';
import { InventorySaga } from './sagas/inventory.saga';

export class InventoryManagementModule implements Module {
  name = 'inventory-management';
  version = '1.0.0';
  config: ModuleConfig;
  
  private stockService: StockService;
  private allocationService: AllocationService;
  private trackingService: InventoryTrackingService;
  private inventoryController: InventoryController;
  private inventorySaga: InventorySaga;
  private isInitialized = false;

  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;
    
    // Get dependencies
    const eventBus = config.dependencies?.['event-bus']?.services.eventBus;
    if (!eventBus) {
      throw new Error('Event bus dependency not found');
    }

    const database = config.dependencies?.['database']?.services.database;
    if (!database) {
      throw new Error('Database dependency not found');
    }

    // Initialize services
    this.stockService = new StockService(eventBus);
    this.allocationService = new AllocationService(this.stockService, eventBus);
    this.trackingService = new InventoryTrackingService(eventBus);
    
    // Initialize saga for complex operations
    this.inventorySaga = new InventorySaga(
      this.stockService,
      this.allocationService,
      eventBus
    );
    
    // Initialize controller
    this.inventoryController = new InventoryController(
      this.stockService,
      this.allocationService,
      this.trackingService,
      this.inventorySaga
    );
    
    // Subscribe to relevant events
    await this.subscribeToEvents(eventBus);
    
    this.isInitialized = true;
    console.log(`${this.name} module initialized`);
  }

  private async subscribeToEvents(eventBus: any): Promise<void> {
    // Subscribe to events from other modules
    eventBus.subscribe('OrderCreated', async (event) => {
      await this.inventorySaga.handleOrderCreated(event);
    });

    eventBus.subscribe('ChannelSyncRequested', async (event) => {
      await this.allocationService.handleChannelSync(event);
    });
  }

  getExports(): ModuleExports {
    if (!this.isInitialized) {
      throw new Error('Module not initialized');
    }
    
    return {
      services: {
        stockService: this.stockService,
        allocationService: this.allocationService,
        trackingService: this.trackingService
      },
      controllers: {
        inventoryController: this.inventoryController
      }
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const checks = {
      initialized: this.isInitialized,
      stockServiceReady: this.stockService?.isReady() || false,
      allocationServiceReady: this.allocationService?.isReady() || false
    };
    
    const isHealthy = Object.values(checks).every(check => check === true);
    
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date(),
      details: checks
    };
  }

  async shutdown(): Promise<void> {
    // Cleanup resources
    this.isInitialized = false;
    console.log(`${this.name} module shut down`);
  }

  isReady(): boolean {
    return this.isInitialized;
  }
}