/**
 * Procurement Domain Module
 * Handles purchase orders, supplier management, and approval workflows
 */

import { Module, ModuleConfig, ModuleExports, HealthCheckResult } from '../../../shared/interfaces/module.interface';
import { PurchaseOrderService } from './services/purchase-order.service';
import { SupplierService } from './services/supplier.service';
import { ApprovalWorkflowService } from './services/approval-workflow.service';
import { ReorderAutomationService } from './services/reorder-automation.service';
import { SupplierPerformanceService } from './services/supplier-performance.service';
import { ProcurementController } from './controllers/procurement.controller';

export class ProcurementModule implements Module {
  name = 'procurement';
  version = '1.0.0';
  config: ModuleConfig;
  
  private purchaseOrderService: PurchaseOrderService;
  private supplierService: SupplierService;
  private approvalWorkflowService: ApprovalWorkflowService;
  private reorderAutomationService: ReorderAutomationService;
  private supplierPerformanceService: SupplierPerformanceService;
  private procurementController: ProcurementController;
  private isInitialized = false;

  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;
    
    // Get dependencies
    const database = config.dependencies?.['database']?.services.database;
    if (!database) {
      throw new Error('Database dependency not found');
    }

    const eventBus = config.dependencies?.['event-bus']?.services.eventBus;
    if (!eventBus) {
      throw new Error('Event bus dependency not found');
    }

    const authorization = config.dependencies?.['authorization']?.services;
    if (!authorization) {
      throw new Error('Authorization dependency not found');
    }

    // Get optional dependencies
    const inventoryService = config.dependencies?.['inventory-management']?.services.stockService;
    const analyticsService = config.dependencies?.['analytics-intelligence']?.services.analyticsService;

    // Initialize services
    this.supplierService = new SupplierService(database, eventBus);
    this.approvalWorkflowService = new ApprovalWorkflowService(
      database,
      eventBus,
      authorization.policyEngine
    );
    this.purchaseOrderService = new PurchaseOrderService(
      database,
      eventBus,
      this.supplierService,
      this.approvalWorkflowService
    );
    this.supplierPerformanceService = new SupplierPerformanceService(
      database,
      this.purchaseOrderService,
      this.supplierService
    );
    this.reorderAutomationService = new ReorderAutomationService(
      database,
      eventBus,
      this.purchaseOrderService,
      inventoryService,
      analyticsService
    );
    
    // Initialize controller
    this.procurementController = new ProcurementController(
      this.purchaseOrderService,
      this.supplierService,
      this.approvalWorkflowService,
      this.reorderAutomationService,
      this.supplierPerformanceService
    );
    
    // Subscribe to relevant events
    await this.subscribeToEvents(eventBus);
    
    // Initialize scheduled tasks
    await this.initializeScheduledTasks();
    
    this.isInitialized = true;
    console.log(`${this.name} module initialized`);
  }

  private async subscribeToEvents(eventBus: any): Promise<void> {
    // Subscribe to inventory events for reorder automation
    eventBus.subscribe('InventoryBelowReorderPoint', async (event) => {
      await this.reorderAutomationService.handleLowInventory(event);
    });

    // Subscribe to order events for supplier performance tracking
    eventBus.subscribe('PurchaseOrderReceived', async (event) => {
      await this.supplierPerformanceService.updatePerformanceMetrics(event);
    });

    // Subscribe to approval events
    eventBus.subscribe('ApprovalRequested', async (event) => {
      await this.approvalWorkflowService.processApprovalRequest(event);
    });
  }

  private async initializeScheduledTasks(): Promise<void> {
    // Schedule daily reorder point check
    setInterval(async () => {
      await this.reorderAutomationService.checkReorderPoints();
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Schedule weekly supplier performance calculation
    setInterval(async () => {
      await this.supplierPerformanceService.calculateWeeklyMetrics();
    }, 7 * 24 * 60 * 60 * 1000); // 7 days
  }

  getExports(): ModuleExports {
    if (!this.isInitialized) {
      throw new Error('Module not initialized');
    }
    
    return {
      services: {
        purchaseOrderService: this.purchaseOrderService,
        supplierService: this.supplierService,
        approvalWorkflowService: this.approvalWorkflowService,
        reorderAutomationService: this.reorderAutomationService,
        supplierPerformanceService: this.supplierPerformanceService
      },
      controllers: {
        procurementController: this.procurementController
      }
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const checks = {
      initialized: this.isInitialized,
      purchaseOrderServiceReady: this.purchaseOrderService?.isReady() || false,
      supplierServiceReady: this.supplierService?.isReady() || false,
      approvalWorkflowReady: this.approvalWorkflowService?.isReady() || false
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