/**
 * Permission Service
 * Manages permissions and permission checks
 */

import { DatabaseService } from '../../../../infrastructure/database/src/services/database.service';
import { EventBusService } from '../../../event-bus/src/event-bus.service';

export interface Permission {
  id: string;
  resource: string;
  action: string;
  description?: string;
  created_at: Date;
}

export class PermissionService {
  private permissionCache = new Map<string, string[]>();
  private cacheTimeout = 10 * 60 * 1000; // 10 minutes
  private lastCacheUpdate = 0;

  constructor(
    private database: DatabaseService,
    private eventBus: EventBusService
  ) {}

  /**
   * Create a new permission
   */
  async createPermission(permission: {
    resource: string;
    action: string;
    description?: string;
  }): Promise<Permission> {
    const result = await this.database.queryOne<Permission>(
      `INSERT INTO permissions (resource, action, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (resource, action) DO UPDATE
       SET description = EXCLUDED.description
       RETURNING *`,
      [permission.resource, permission.action, permission.description]
    );

    if (!result) {
      throw new Error('Failed to create permission');
    }

    // Clear cache
    this.clearCache();

    await this.eventBus.publish({
      eventType: 'PermissionCreated',
      aggregateId: result.id,
      aggregateType: 'Permission',
      payload: result,
      metadata: {
        timestamp: new Date().toISOString()
      }
    });

    return result;
  }

  /**
   * Delete a permission
   */
  async deletePermission(resource: string, action: string): Promise<void> {
    const result = await this.database.query(
      'DELETE FROM permissions WHERE resource = $1 AND action = $2',
      [resource, action]
    );

    if (result.rowCount === 0) {
      throw new Error('Permission not found');
    }

    // Clear cache
    this.clearCache();

    await this.eventBus.publish({
      eventType: 'PermissionDeleted',
      aggregateId: `${resource}:${action}`,
      aggregateType: 'Permission',
      payload: { resource, action },
      metadata: {
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Get all permissions
   */
  async getAllPermissions(): Promise<Permission[]> {
    return await this.database.queryMany<Permission>(
      'SELECT * FROM permissions ORDER BY resource, action'
    );
  }

  /**
   * Get permissions by resource
   */
  async getPermissionsByResource(resource: string): Promise<Permission[]> {
    return await this.database.queryMany<Permission>(
      'SELECT * FROM permissions WHERE resource = $1 ORDER BY action',
      [resource]
    );
  }

  /**
   * Get permissions for roles
   */
  async getPermissionsForRoles(roleNames: string[]): Promise<string[]> {
    if (roleNames.length === 0) {
      return [];
    }

    // Check cache
    const cacheKey = roleNames.sort().join(',');
    const cached = this.permissionCache.get(cacheKey);
    if (cached && Date.now() - this.lastCacheUpdate < this.cacheTimeout) {
      return cached;
    }

    // Query database
    const placeholders = roleNames.map((_, index) => `$${index + 1}`).join(', ');
    const result = await this.database.queryMany<{ permissions: any }>(
      `SELECT DISTINCT jsonb_array_elements_text(permissions) as permission
       FROM roles
       WHERE name IN (${placeholders})`,
      roleNames
    );

    const permissions = result.map(r => r.permission);

    // Update cache
    this.permissionCache.set(cacheKey, permissions);
    this.lastCacheUpdate = Date.now();

    return permissions;
  }

  /**
   * Check if permission exists
   */
  async permissionExists(resource: string, action: string): Promise<boolean> {
    const result = await this.database.queryOne<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM permissions 
        WHERE resource = $1 AND action = $2
      )`,
      [resource, action]
    );

    return result?.exists || false;
  }

  /**
   * Bulk create permissions
   */
  async bulkCreatePermissions(
    permissions: Array<{
      resource: string;
      action: string;
      description?: string;
    }>
  ): Promise<Permission[]> {
    if (permissions.length === 0) {
      return [];
    }

    // Prepare bulk insert
    const values = permissions.map(p => [p.resource, p.action, p.description]);
    const placeholders = permissions.map((_, index) => {
      const base = index * 3;
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    }).join(', ');

    const result = await this.database.queryMany<Permission>(
      `INSERT INTO permissions (resource, action, description)
       VALUES ${placeholders}
       ON CONFLICT (resource, action) DO UPDATE
       SET description = EXCLUDED.description
       RETURNING *`,
      values.flat()
    );

    // Clear cache
    this.clearCache();

    await this.eventBus.publish({
      eventType: 'PermissionsBulkCreated',
      aggregateId: 'bulk',
      aggregateType: 'Permission',
      payload: {
        count: result.length,
        permissions: result
      },
      metadata: {
        timestamp: new Date().toISOString()
      }
    });

    return result;
  }

  /**
   * Generate standard CRUD permissions for a resource
   */
  async generateCRUDPermissions(
    resource: string,
    description?: string
  ): Promise<Permission[]> {
    const actions = ['create', 'read', 'update', 'delete'];
    const permissions = actions.map(action => ({
      resource,
      action,
      description: `${description || resource} - ${action}`
    }));

    return await this.bulkCreatePermissions(permissions);
  }

  /**
   * Get permission patterns (for wildcard matching)
   */
  async getPermissionPatterns(): Promise<Array<{
    pattern: string;
    resources: string[];
    actions: string[];
  }>> {
    // Get all unique resources and actions
    const permissions = await this.getAllPermissions();
    
    const resources = [...new Set(permissions.map(p => p.resource))];
    const actions = [...new Set(permissions.map(p => p.action))];

    // Generate common patterns
    const patterns = [
      {
        pattern: '*:*',
        resources: ['*'],
        actions: ['*']
      },
      ...resources.map(resource => ({
        pattern: `${resource}:*`,
        resources: [resource],
        actions: ['*']
      })),
      ...actions.map(action => ({
        pattern: `*:${action}`,
        resources: ['*'],
        actions: [action]
      }))
    ];

    return patterns;
  }

  /**
   * Validate permission format
   */
  validatePermissionFormat(permission: string): boolean {
    const pattern = /^[\w\-\*]+:[\w\-\*]+$/;
    return pattern.test(permission);
  }

  /**
   * Parse permission string
   */
  parsePermission(permission: string): { resource: string; action: string } | null {
    if (!this.validatePermissionFormat(permission)) {
      return null;
    }

    const [resource, action] = permission.split(':');
    return { resource, action };
  }

  /**
   * Clear cache
   */
  private clearCache(): void {
    this.permissionCache.clear();
    this.lastCacheUpdate = 0;
  }

  /**
   * Get permission statistics
   */
  async getPermissionStats(): Promise<{
    totalPermissions: number;
    resourceCount: number;
    actionCount: number;
    topResources: Array<{ resource: string; count: number }>;
    topActions: Array<{ action: string; count: number }>;
  }> {
    const permissions = await this.getAllPermissions();
    
    const resourceCounts = new Map<string, number>();
    const actionCounts = new Map<string, number>();
    
    permissions.forEach(p => {
      resourceCounts.set(p.resource, (resourceCounts.get(p.resource) || 0) + 1);
      actionCounts.set(p.action, (actionCounts.get(p.action) || 0) + 1);
    });

    const topResources = Array.from(resourceCounts.entries())
      .map(([resource, count]) => ({ resource, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topActions = Array.from(actionCounts.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalPermissions: permissions.length,
      resourceCount: resourceCounts.size,
      actionCount: actionCounts.size,
      topResources,
      topActions
    };
  }
}