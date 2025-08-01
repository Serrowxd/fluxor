/**
 * Module Container - Dependency Injection Container
 * Manages module lifecycle and dependencies
 */

import { Module, ModuleRegistry, HealthCheckResult } from '../interfaces/module.interface';

export class ModuleContainer implements ModuleRegistry {
  private modules = new Map<string, Module>();
  private dependencies = new Map<string, Set<string>>();
  private initializationOrder: string[] = [];

  async register(module: Module): Promise<void> {
    if (this.modules.has(module.name)) {
      throw new Error(`Module ${module.name} is already registered`);
    }

    // Validate dependencies exist
    if (module.config.dependencies) {
      for (const dep of module.config.dependencies) {
        if (!this.modules.has(dep)) {
          throw new Error(`Module ${module.name} depends on ${dep} which is not registered`);
        }
      }
    }

    // Register module
    this.modules.set(module.name, module);
    
    // Track dependencies
    if (module.config.dependencies) {
      this.dependencies.set(module.name, new Set(module.config.dependencies));
    }

    // Initialize module with injected dependencies
    const deps = await this.resolveDependencies(module.name);
    await module.initialize({
      ...module.config,
      dependencies: deps
    });

    this.initializationOrder.push(module.name);
    
    console.log(`Module ${module.name} v${module.version} registered successfully`);
  }

  get(name: string): Module | undefined {
    return this.modules.get(name);
  }

  getAll(): Module[] {
    return Array.from(this.modules.values());
  }

  async unregister(name: string): Promise<void> {
    const module = this.modules.get(name);
    if (!module) {
      throw new Error(`Module ${name} not found`);
    }

    // Check if other modules depend on this one
    for (const [modName, deps] of this.dependencies.entries()) {
      if (deps.has(name)) {
        throw new Error(`Cannot unregister ${name}: ${modName} depends on it`);
      }
    }

    // Shutdown module
    await module.shutdown();
    
    // Remove from registry
    this.modules.delete(name);
    this.dependencies.delete(name);
    this.initializationOrder = this.initializationOrder.filter(m => m !== name);
    
    console.log(`Module ${name} unregistered successfully`);
  }

  async healthCheckAll(): Promise<Record<string, HealthCheckResult>> {
    const results: Record<string, HealthCheckResult> = {};
    
    for (const [name, module] of this.modules.entries()) {
      try {
        results[name] = await module.healthCheck();
      } catch (error) {
        results[name] = {
          status: 'unhealthy',
          timestamp: new Date(),
          details: { error: error.message }
        };
      }
    }
    
    return results;
  }

  private async resolveDependencies(moduleName: string): Promise<string[]> {
    const module = this.modules.get(moduleName);
    if (!module || !module.config.dependencies) {
      return [];
    }

    const resolved: string[] = [];
    const visiting = new Set<string>();

    const resolve = (name: string) => {
      if (resolved.includes(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected: ${name}`);
      }

      visiting.add(name);
      
      const deps = this.dependencies.get(name);
      if (deps) {
        for (const dep of deps) {
          resolve(dep);
        }
      }
      
      visiting.delete(name);
      resolved.push(name);
    };

    for (const dep of module.config.dependencies) {
      resolve(dep);
    }

    return resolved;
  }

  /**
   * Get module exports for dependency injection
   */
  getModuleExports(moduleName: string): any {
    const module = this.modules.get(moduleName);
    if (!module) {
      throw new Error(`Module ${moduleName} not found`);
    }
    return module.getExports();
  }

  /**
   * Shutdown all modules in reverse initialization order
   */
  async shutdownAll(): Promise<void> {
    const shutdownOrder = [...this.initializationOrder].reverse();
    
    for (const moduleName of shutdownOrder) {
      const module = this.modules.get(moduleName);
      if (module) {
        try {
          await module.shutdown();
          console.log(`Module ${moduleName} shut down successfully`);
        } catch (error) {
          console.error(`Error shutting down module ${moduleName}:`, error);
        }
      }
    }
    
    this.modules.clear();
    this.dependencies.clear();
    this.initializationOrder = [];
  }
}