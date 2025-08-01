/**
 * Modular Fluxor Application Bootstrap
 * Initializes and orchestrates all modules
 */

import { ModuleContainer } from './shared/utils/module-container';
import { AuthenticationModule } from './core-platform/authentication/src';
import { EventBusModule } from './core-platform/event-bus/src';
import { DatabaseModule } from './infrastructure/database/src';
import { InventoryManagementModule } from './business-domains/inventory-management/src';
import { MigrationProxy } from './infrastructure/migration-proxy';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export class FluxorModularApp {
  private moduleContainer: ModuleContainer;
  private migrationProxy: MigrationProxy;

  constructor() {
    this.moduleContainer = new ModuleContainer();
  }

  async initialize(): Promise<void> {
    console.log('Initializing Fluxor Modular Architecture...');

    try {
      // Phase 1: Core Platform Modules
      await this.initializeCoreModules();
      
      // Phase 2: Business Domain Modules
      await this.initializeBusinessModules();
      
      // Phase 3: Setup Migration Proxy
      await this.setupMigrationProxy();
      
      console.log('All modules initialized successfully');
    } catch (error) {
      console.error('Failed to initialize modules:', error);
      throw error;
    }
  }

  private async initializeCoreModules(): Promise<void> {
    console.log('Initializing core platform modules...');

    // Event Bus (no dependencies)
    const eventBusModule = new EventBusModule();
    await this.moduleContainer.register(eventBusModule);

    // Database (no dependencies)
    const databaseModule = new DatabaseModule();
    await this.moduleContainer.register(databaseModule);

    // Authentication (depends on event bus)
    const authModule = new AuthenticationModule();
    await this.moduleContainer.register(authModule);

    // Authorization (depends on event bus and database)
    const { AuthorizationModule } = await import('./core-platform/authorization/src');
    const authzModule = new AuthorizationModule();
    await this.moduleContainer.register(authzModule);

    // Future core modules would be registered here:
    // - Service Registry
    // - Tenant Management
  }

  private async initializeBusinessModules(): Promise<void> {
    console.log('Initializing business domain modules...');

    // Inventory Management (depends on event bus)
    const inventoryModule = new InventoryManagementModule();
    await this.moduleContainer.register(inventoryModule);

    // Future business modules would be registered here:
    // - Order Management
    // - Channel Integration
    // - Analytics Intelligence
    // - Procurement Domain
  }

  private async setupMigrationProxy(): Promise<void> {
    console.log('Setting up migration proxy...');

    const featureFlags = new Map<string, boolean>([
      ['authentication', true],        // Fully migrated
      ['inventory-management', false], // Gradual migration
      ['channel-integration', false],  // Not migrated yet
      ['analytics', false],           // Not migrated yet
      ['procurement', false]          // Not migrated yet
    ]);

    this.migrationProxy = new MigrationProxy(this.moduleContainer, {
      legacyBaseUrl: process.env.LEGACY_BACKEND_URL || 'http://localhost:3001',
      newModulesBaseUrl: process.env.NEW_MODULES_URL || 'http://localhost:4000',
      featureFlags
    });
  }

  async start(): Promise<void> {
    const port = parseInt(process.env.PROXY_PORT || '4000', 10);
    
    // Start health check interval
    this.startHealthChecks();
    
    // Start migration proxy
    await this.migrationProxy.start(port);
    
    console.log(`
    ╔═══════════════════════════════════════════════════════════╗
    ║          Fluxor Modular Architecture Started              ║
    ╠═══════════════════════════════════════════════════════════╣
    ║  Migration Proxy: http://localhost:${port}                    ║
    ║  Health Check: http://localhost:${port}/health               ║
    ║  Legacy Backend: ${process.env.LEGACY_BACKEND_URL || 'http://localhost:3001'}           ║
    ╚═══════════════════════════════════════════════════════════╝
    `);

    // Graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  private startHealthChecks(): void {
    setInterval(async () => {
      const health = await this.moduleContainer.healthCheckAll();
      const unhealthyModules = Object.entries(health)
        .filter(([_, status]) => status.status !== 'healthy')
        .map(([name]) => name);
      
      if (unhealthyModules.length > 0) {
        console.warn('Unhealthy modules detected:', unhealthyModules);
      }
    }, 30000); // Check every 30 seconds
  }

  private async shutdown(): Promise<void> {
    console.log('\nShutting down Fluxor Modular App...');
    
    try {
      await this.moduleContainer.shutdownAll();
      console.log('All modules shut down successfully');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  // Feature flag management
  enableFeature(feature: string): void {
    this.migrationProxy.enableFeature(feature);
  }

  disableFeature(feature: string): void {
    this.migrationProxy.disableFeature(feature);
  }
}

// Bootstrap the application
if (require.main === module) {
  const app = new FluxorModularApp();
  
  app.initialize()
    .then(() => app.start())
    .catch(error => {
      console.error('Failed to start application:', error);
      process.exit(1);
    });
}