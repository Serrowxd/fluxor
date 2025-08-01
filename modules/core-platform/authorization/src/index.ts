/**
 * Authorization Module
 * Implements RBAC/ABAC with policy engine for fine-grained access control
 */

import { Module, ModuleConfig, ModuleExports, HealthCheckResult } from '../../../shared/interfaces/module.interface';
import { AuthorizationService } from './services/authorization.service';
import { PolicyEngine } from './services/policy-engine.service';
import { RoleService } from './services/role.service';
import { PermissionService } from './services/permission.service';
import { PolicyService } from './services/policy.service';
import { authorizationMiddleware } from './middleware/authorization.middleware';

export class AuthorizationModule implements Module {
  name = 'authorization';
  version = '1.0.0';
  config: ModuleConfig;
  
  private authorizationService: AuthorizationService;
  private policyEngine: PolicyEngine;
  private roleService: RoleService;
  private permissionService: PermissionService;
  private policyService: PolicyService;
  private isInitialized = false;

  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;
    
    // Get dependencies
    const eventBus = config.dependencies?.['event-bus']?.services.eventBus;
    const database = config.dependencies?.['database']?.services.database;
    
    if (!eventBus) {
      throw new Error('Event bus dependency not found');
    }
    
    if (!database) {
      throw new Error('Database dependency not found');
    }

    // Initialize services
    this.roleService = new RoleService(database, eventBus);
    this.permissionService = new PermissionService(database, eventBus);
    this.policyService = new PolicyService(database, eventBus);
    this.policyEngine = new PolicyEngine(this.policyService);
    
    this.authorizationService = new AuthorizationService(
      this.roleService,
      this.permissionService,
      this.policyEngine,
      eventBus
    );

    // Initialize database tables
    await this.initializeTables(database);
    
    // Load default policies
    await this.loadDefaultPolicies();
    
    this.isInitialized = true;
    console.log(`${this.name} module initialized`);
  }

  private async initializeTables(database: any): Promise<void> {
    // Create roles table
    await database.createTable('roles', {
      id: 'UUID PRIMARY KEY DEFAULT gen_random_uuid()',
      name: 'VARCHAR(255) UNIQUE NOT NULL',
      description: 'TEXT',
      permissions: 'JSONB DEFAULT \'[]\'::jsonb',
      metadata: 'JSONB DEFAULT \'{}\'::jsonb',
      created_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
      updated_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
    }, { ifNotExists: true });

    // Create user_roles table
    await database.createTable('user_roles', {
      user_id: 'UUID NOT NULL',
      role_id: 'UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE',
      granted_by: 'UUID',
      granted_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
      expires_at: 'TIMESTAMP',
      metadata: 'JSONB DEFAULT \'{}\'::jsonb'
    }, { 
      ifNotExists: true,
      primaryKey: ['user_id', 'role_id']
    });

    // Create permissions table
    await database.createTable('permissions', {
      id: 'UUID PRIMARY KEY DEFAULT gen_random_uuid()',
      resource: 'VARCHAR(255) NOT NULL',
      action: 'VARCHAR(255) NOT NULL',
      description: 'TEXT',
      created_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
    }, { 
      ifNotExists: true,
      indexes: [{
        name: 'idx_permissions_resource_action',
        columns: ['resource', 'action'],
        unique: true
      }]
    });

    // Create policies table for ABAC
    await database.createTable('policies', {
      id: 'UUID PRIMARY KEY DEFAULT gen_random_uuid()',
      name: 'VARCHAR(255) UNIQUE NOT NULL',
      description: 'TEXT',
      effect: 'VARCHAR(10) CHECK (effect IN (\'allow\', \'deny\'))',
      subjects: 'JSONB NOT NULL',
      resources: 'JSONB NOT NULL',
      actions: 'JSONB NOT NULL',
      conditions: 'JSONB DEFAULT \'{}\'::jsonb',
      priority: 'INTEGER DEFAULT 0',
      enabled: 'BOOLEAN DEFAULT true',
      created_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
      updated_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
    }, { ifNotExists: true });

    // Enable RLS for multi-tenancy
    await database.enableRLS('user_roles');
    await database.createRLSPolicy('user_roles_tenant_isolation', 'user_roles', {
      using: 'user_id = current_setting(\'app.user_id\')::uuid OR EXISTS (SELECT 1 FROM roles WHERE id = role_id AND name = \'admin\')'
    });
  }

  private async loadDefaultPolicies(): Promise<void> {
    // Load default admin policy
    await this.policyService.createPolicy({
      name: 'admin-full-access',
      description: 'Administrators have full access',
      effect: 'allow',
      subjects: [{ type: 'role', id: 'admin' }],
      resources: ['*'],
      actions: ['*'],
      conditions: {}
    });

    // Load default user policies
    await this.policyService.createPolicy({
      name: 'user-read-own-data',
      description: 'Users can read their own data',
      effect: 'allow',
      subjects: [{ type: 'authenticated' }],
      resources: ['user:${user.id}', 'profile:${user.id}'],
      actions: ['read'],
      conditions: {}
    });
  }

  getExports(): ModuleExports {
    if (!this.isInitialized) {
      throw new Error('Authorization module not initialized');
    }
    
    return {
      services: {
        authorization: this.authorizationService,
        policyEngine: this.policyEngine,
        roleService: this.roleService,
        permissionService: this.permissionService,
        policyService: this.policyService
      },
      middleware: {
        authorize: authorizationMiddleware(this.authorizationService)
      }
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const checks = {
      initialized: this.isInitialized,
      policiesLoaded: await this.policyService.getPolicyCount() > 0,
      rolesAvailable: await this.roleService.getRoleCount() > 0
    };
    
    const isHealthy = Object.values(checks).every(check => check === true);
    
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date(),
      details: checks
    };
  }

  async shutdown(): Promise<void> {
    this.isInitialized = false;
    console.log(`${this.name} module shut down`);
  }

  isReady(): boolean {
    return this.isInitialized;
  }
}

export { AuthorizationService, PolicyEngine, RoleService, PermissionService, PolicyService };