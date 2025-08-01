/**
 * Database Module
 * Provides database abstraction layer with connection pooling and query building
 */

import { Module, ModuleConfig, ModuleExports, HealthCheckResult } from '../../../shared/interfaces/module.interface';
import { DatabaseService } from './services/database.service';
import { QueryBuilder } from './services/query-builder.service';
import { MigrationService } from './services/migration.service';
import { TransactionManager } from './services/transaction-manager.service';

export class DatabaseModule implements Module {
  name = 'database';
  version = '1.0.0';
  config: ModuleConfig;
  
  private databaseService: DatabaseService;
  private queryBuilder: QueryBuilder;
  private migrationService: MigrationService;
  private transactionManager: TransactionManager;
  private isInitialized = false;

  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;
    
    // Initialize database service with connection pool
    this.databaseService = new DatabaseService({
      host: config.settings?.DB_HOST || process.env.DB_HOST || 'localhost',
      port: config.settings?.DB_PORT || parseInt(process.env.DB_PORT || '5432'),
      database: config.settings?.DB_NAME || process.env.DB_NAME || 'fluxor',
      user: config.settings?.DB_USER || process.env.DB_USER || 'postgres',
      password: config.settings?.DB_PASSWORD || process.env.DB_PASSWORD || '',
      max: config.settings?.DB_POOL_MAX || 20,
      idleTimeoutMillis: config.settings?.DB_IDLE_TIMEOUT || 30000,
      connectionTimeoutMillis: config.settings?.DB_CONNECTION_TIMEOUT || 2000,
    });

    await this.databaseService.connect();
    
    // Initialize other services
    this.queryBuilder = new QueryBuilder();
    this.transactionManager = new TransactionManager(this.databaseService);
    this.migrationService = new MigrationService(this.databaseService);
    
    this.isInitialized = true;
    console.log(`${this.name} module initialized`);
  }

  getExports(): ModuleExports {
    if (!this.isInitialized) {
      throw new Error('Database module not initialized');
    }
    
    return {
      services: {
        database: this.databaseService,
        queryBuilder: this.queryBuilder,
        transactionManager: this.transactionManager,
        migrationService: this.migrationService
      }
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const isConnected = await this.databaseService.healthCheck();
    
    return {
      status: isConnected ? 'healthy' : 'unhealthy',
      timestamp: new Date(),
      details: {
        connected: isConnected,
        poolSize: this.databaseService.getPoolSize(),
        activeConnections: this.databaseService.getActiveConnections(),
        idleConnections: this.databaseService.getIdleConnections()
      }
    };
  }

  async shutdown(): Promise<void> {
    await this.databaseService.disconnect();
    this.isInitialized = false;
    console.log(`${this.name} module shut down`);
  }

  isReady(): boolean {
    return this.isInitialized && this.databaseService.isConnected();
  }
}

export { DatabaseService, QueryBuilder, TransactionManager, MigrationService };