/**
 * Migration Proxy
 * Implements Strangler Fig pattern for gradual migration
 */

import express, { Request, Response, NextFunction } from 'express';
import httpProxy from 'http-proxy-middleware';
import { ModuleContainer } from '../../shared/utils/module-container';

export interface MigrationConfig {
  legacyBaseUrl: string;
  newModulesBaseUrl: string;
  featureFlags: Map<string, boolean>;
}

export class MigrationProxy {
  private app: express.Application;
  private moduleContainer: ModuleContainer;
  private config: MigrationConfig;
  private legacyProxy: any;

  constructor(moduleContainer: ModuleContainer, config: MigrationConfig) {
    this.app = express();
    this.moduleContainer = moduleContainer;
    this.config = config;
    
    // Create proxy for legacy app
    this.legacyProxy = httpProxy.createProxyMiddleware({
      target: config.legacyBaseUrl,
      changeOrigin: true,
      logLevel: 'info'
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', async (req: Request, res: Response) => {
      const moduleHealth = await this.moduleContainer.healthCheckAll();
      res.json({
        status: 'healthy',
        modules: moduleHealth,
        migration: {
          featureFlags: Array.from(this.config.featureFlags.entries())
        }
      });
    });

    // Authentication routes - migrated
    this.app.use('/api/v1/auth', this.routeToModule('authentication'));
    
    // Authorization routes - migrated
    this.app.use('/api/v1/authorization', this.routeToModule('authorization'));
    
    // Inventory routes - conditionally migrated
    this.app.use('/api/v1/inventory', (req: Request, res: Response, next: NextFunction) => {
      if (this.isFeatureEnabled('inventory-management')) {
        this.routeToModule('inventory-management')(req, res, next);
      } else {
        this.legacyProxy(req, res, next);
      }
    });

    // Channel integration routes - conditionally migrated
    this.app.use('/api/v1/channels', (req: Request, res: Response, next: NextFunction) => {
      if (this.isFeatureEnabled('channel-integration')) {
        this.routeToModule('channel-integration')(req, res, next);
      } else {
        this.legacyProxy(req, res, next);
      }
    });

    // Analytics routes - legacy for now
    this.app.use('/api/v1/analytics', this.legacyProxy);
    
    // Purchase order routes - legacy for now
    this.app.use('/api/v1/purchase-orders', this.legacyProxy);

    // Default route to legacy
    this.app.use('*', this.legacyProxy);
  }

  private routeToModule(moduleName: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const module = this.moduleContainer.get(moduleName);
        
        if (!module || !module.isReady()) {
          // Fallback to legacy if module not ready
          console.warn(`Module ${moduleName} not ready, falling back to legacy`);
          return this.legacyProxy(req, res, next);
        }

        const exports = module.getExports();
        const controller = this.getControllerForRoute(exports.controllers, req.path);
        
        if (controller) {
          await controller(req, res, next);
        } else {
          res.status(404).json({ error: 'Route not found in module' });
        }
      } catch (error) {
        console.error(`Error routing to module ${moduleName}:`, error);
        // Fallback to legacy on error
        this.legacyProxy(req, res, next);
      }
    };
  }

  private getControllerForRoute(controllers: any, path: string): Function | null {
    // For inventory module, return the router directly
    if (controllers && controllers.inventoryController && controllers.inventoryController.getRouter) {
      return (req: Request, res: Response, next: NextFunction) => {
        const router = controllers.inventoryController.getRouter();
        router(req, res, next);
      };
    }
    
    // For auth module, handle specific routes
    const route = path.split('/').pop();
    
    const routeMap = {
      'login': 'login',
      'refresh': 'refresh',
      'logout': 'logout'
    };

    const methodName = routeMap[route];
    if (methodName && controllers && controllers.authController) {
      return controllers.authController[methodName];
    }
    
    return null;
  }

  private isFeatureEnabled(feature: string): boolean {
    return this.config.featureFlags.get(feature) || false;
  }

  enableFeature(feature: string): void {
    this.config.featureFlags.set(feature, true);
    console.log(`Feature ${feature} enabled for migration`);
  }

  disableFeature(feature: string): void {
    this.config.featureFlags.set(feature, false);
    console.log(`Feature ${feature} disabled, routing to legacy`);
  }

  getApp(): express.Application {
    return this.app;
  }

  async start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(port, () => {
        console.log(`Migration proxy listening on port ${port}`);
        console.log(`Legacy backend: ${this.config.legacyBaseUrl}`);
        console.log(`Enabled features: ${Array.from(this.config.featureFlags.entries())
          .filter(([_, enabled]) => enabled)
          .map(([feature]) => feature)
          .join(', ')}`);
        resolve();
      });
    });
  }
}