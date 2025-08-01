/**
 * Event Bus Module
 * Handles inter-module communication via domain events
 */

import { Module, ModuleConfig, ModuleExports, HealthCheckResult } from '../../../shared/interfaces/module.interface';
import { EventBusService } from './services/event-bus.service';
import { SchemaRegistry } from './services/schema-registry';
import { EventStore } from './services/event-store';

export class EventBusModule implements Module {
  name = 'event-bus';
  version = '1.0.0';
  config: ModuleConfig;
  
  private eventBusService: EventBusService;
  private schemaRegistry: SchemaRegistry;
  private eventStore: EventStore;
  private isInitialized = false;

  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;
    
    // Initialize services
    this.schemaRegistry = new SchemaRegistry();
    this.eventStore = new EventStore();
    
    this.eventBusService = new EventBusService(
      this.schemaRegistry,
      this.eventStore,
      {
        brokers: config.environment?.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
        clientId: config.environment?.KAFKA_CLIENT_ID || 'fluxor-event-bus'
      }
    );
    
    await this.eventBusService.connect();
    
    this.isInitialized = true;
    console.log(`${this.name} module initialized`);
  }

  getExports(): ModuleExports {
    if (!this.isInitialized) {
      throw new Error('Module not initialized');
    }
    
    return {
      services: {
        eventBus: this.eventBusService,
        schemaRegistry: this.schemaRegistry,
        eventStore: this.eventStore
      }
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const checks = {
      initialized: this.isInitialized,
      eventBusConnected: await this.eventBusService?.isConnected() || false,
      eventStoreReady: this.eventStore?.isReady() || false
    };
    
    const isHealthy = Object.values(checks).every(check => check === true);
    
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date(),
      details: checks
    };
  }

  async shutdown(): Promise<void> {
    await this.eventBusService?.disconnect();
    await this.eventStore?.close();
    this.isInitialized = false;
    console.log(`${this.name} module shut down`);
  }

  isReady(): boolean {
    return this.isInitialized && this.eventBusService?.isConnected();
  }
}