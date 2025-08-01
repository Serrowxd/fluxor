/**
 * Core Module Interface
 * Defines the contract that all modules must implement
 */

export interface ModuleConfig {
  name: string;
  version: string;
  description?: string;
  environment?: Record<string, any>;
  dependencies?: string[];
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  details?: Record<string, any>;
  dependencies?: Record<string, HealthCheckResult>;
}

export interface ModuleExports {
  services: Record<string, any>;
  controllers?: Record<string, any>;
  middleware?: Record<string, any>;
  models?: Record<string, any>;
}

export interface Module {
  name: string;
  version: string;
  config: ModuleConfig;
  
  /**
   * Initialize the module with configuration
   */
  initialize(config: ModuleConfig): Promise<void>;
  
  /**
   * Get module exports for dependency injection
   */
  getExports(): ModuleExports;
  
  /**
   * Perform health check on the module
   */
  healthCheck(): Promise<HealthCheckResult>;
  
  /**
   * Gracefully shutdown the module
   */
  shutdown(): Promise<void>;
  
  /**
   * Check if module is ready to accept requests
   */
  isReady(): boolean;
}

export interface ModuleRegistry {
  /**
   * Register a module with the system
   */
  register(module: Module): Promise<void>;
  
  /**
   * Get a registered module by name
   */
  get(name: string): Module | undefined;
  
  /**
   * Get all registered modules
   */
  getAll(): Module[];
  
  /**
   * Unregister a module
   */
  unregister(name: string): Promise<void>;
  
  /**
   * Check health of all modules
   */
  healthCheckAll(): Promise<Record<string, HealthCheckResult>>;
}

export interface DomainEvent<T = any> {
  id: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  eventVersion: number;
  timestamp: Date;
  data: T;
  metadata?: Record<string, any>;
  headers?: Record<string, string>;
}

export interface EventBus {
  /**
   * Publish an event to the bus
   */
  publish<T>(event: DomainEvent<T>): Promise<void>;
  
  /**
   * Subscribe to events of a specific type
   */
  subscribe<T>(
    eventType: string,
    handler: (event: DomainEvent<T>) => Promise<void>
  ): void;
  
  /**
   * Unsubscribe from events
   */
  unsubscribe(eventType: string, handler: Function): void;
}