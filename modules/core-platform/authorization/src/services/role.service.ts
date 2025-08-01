/**
 * Role Service
 * Manages roles and user-role assignments
 */

import { DatabaseService } from '../../../../infrastructure/database/src/services/database.service';
import { EventBusService } from '../../../event-bus/src/event-bus.service';

export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface UserRole {
  user_id: string;
  role_id: string;
  role?: Role;
  granted_by?: string;
  granted_at: Date;
  expires_at?: Date;
  metadata?: Record<string, any>;
}

export class RoleService {
  private cache = new Map<string, { roles: Role[]; timestamp: number }>();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  constructor(
    private database: DatabaseService,
    private eventBus: EventBusService
  ) {}

  /**
   * Create a new role
   */
  async createRole(role: {
    name: string;
    description?: string;
    permissions: string[];
    metadata?: Record<string, any>;
  }): Promise<Role> {
    const result = await this.database.queryOne<Role>(
      `INSERT INTO roles (name, description, permissions, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [role.name, role.description, JSON.stringify(role.permissions), role.metadata || {}]
    );

    if (!result) {
      throw new Error('Failed to create role');
    }

    await this.eventBus.publish({
      eventType: 'RoleCreated',
      aggregateId: result.id,
      aggregateType: 'Role',
      payload: result,
      metadata: {
        timestamp: new Date().toISOString()
      }
    });

    return result;
  }

  /**
   * Update a role
   */
  async updateRole(
    roleId: string,
    updates: {
      description?: string;
      permissions?: string[];
      metadata?: Record<string, any>;
    }
  ): Promise<Role> {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    if (updates.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }

    if (updates.permissions !== undefined) {
      setClauses.push(`permissions = $${paramIndex++}`);
      values.push(JSON.stringify(updates.permissions));
    }

    if (updates.metadata !== undefined) {
      setClauses.push(`metadata = $${paramIndex++}`);
      values.push(updates.metadata);
    }

    setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(roleId);

    const result = await this.database.queryOne<Role>(
      `UPDATE roles 
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    if (!result) {
      throw new Error('Role not found');
    }

    // Clear cache
    this.clearAllCache();

    await this.eventBus.publish({
      eventType: 'RoleUpdated',
      aggregateId: roleId,
      aggregateType: 'Role',
      payload: result,
      metadata: {
        timestamp: new Date().toISOString()
      }
    });

    return result;
  }

  /**
   * Delete a role
   */
  async deleteRole(roleId: string): Promise<void> {
    const result = await this.database.query(
      'DELETE FROM roles WHERE id = $1',
      [roleId]
    );

    if (result.rowCount === 0) {
      throw new Error('Role not found');
    }

    // Clear cache
    this.clearAllCache();

    await this.eventBus.publish({
      eventType: 'RoleDeleted',
      aggregateId: roleId,
      aggregateType: 'Role',
      payload: { roleId },
      metadata: {
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Get role by ID
   */
  async getRole(roleId: string): Promise<Role | null> {
    return await this.database.queryOne<Role>(
      'SELECT * FROM roles WHERE id = $1',
      [roleId]
    );
  }

  /**
   * Get role by name
   */
  async getRoleByName(name: string): Promise<Role | null> {
    return await this.database.queryOne<Role>(
      'SELECT * FROM roles WHERE name = $1',
      [name]
    );
  }

  /**
   * Get all roles
   */
  async getAllRoles(): Promise<Role[]> {
    return await this.database.queryMany<Role>(
      'SELECT * FROM roles ORDER BY name'
    );
  }

  /**
   * Assign role to user
   */
  async assignRole(
    userId: string,
    roleName: string,
    grantedBy?: string,
    expiresAt?: Date,
    metadata?: Record<string, any>
  ): Promise<UserRole> {
    // Get role by name
    const role = await this.getRoleByName(roleName);
    if (!role) {
      throw new Error(`Role '${roleName}' not found`);
    }

    // Insert or update user role
    const result = await this.database.queryOne<UserRole>(
      `INSERT INTO user_roles (user_id, role_id, granted_by, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, role_id) 
       DO UPDATE SET 
         granted_by = EXCLUDED.granted_by,
         granted_at = CURRENT_TIMESTAMP,
         expires_at = EXCLUDED.expires_at,
         metadata = EXCLUDED.metadata
       RETURNING *`,
      [userId, role.id, grantedBy, expiresAt, metadata || {}]
    );

    if (!result) {
      throw new Error('Failed to assign role');
    }

    // Clear user cache
    this.clearCache(userId);

    return result;
  }

  /**
   * Remove role from user
   */
  async removeRole(userId: string, roleName: string): Promise<void> {
    const role = await this.getRoleByName(roleName);
    if (!role) {
      throw new Error(`Role '${roleName}' not found`);
    }

    const result = await this.database.query(
      'DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2',
      [userId, role.id]
    );

    if (result.rowCount === 0) {
      throw new Error('User role assignment not found');
    }

    // Clear user cache
    this.clearCache(userId);
  }

  /**
   * Get user's roles
   */
  async getUserRoles(userId: string): Promise<Role[]> {
    // Check cache
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.roles;
    }

    // Query database
    const roles = await this.database.queryMany<Role>(
      `SELECT r.* FROM roles r
       INNER JOIN user_roles ur ON r.id = ur.role_id
       WHERE ur.user_id = $1
       AND (ur.expires_at IS NULL OR ur.expires_at > CURRENT_TIMESTAMP)
       ORDER BY r.name`,
      [userId]
    );

    // Update cache
    this.cache.set(userId, { roles, timestamp: Date.now() });

    return roles;
  }

  /**
   * Get users with role
   */
  async getUsersWithRole(roleName: string): Promise<string[]> {
    const role = await this.getRoleByName(roleName);
    if (!role) {
      return [];
    }

    const result = await this.database.queryMany<{ user_id: string }>(
      `SELECT user_id FROM user_roles
       WHERE role_id = $1
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
      [role.id]
    );

    return result.map(r => r.user_id);
  }

  /**
   * Check if user has role
   */
  async userHasRole(userId: string, roleName: string): Promise<boolean> {
    const roles = await this.getUserRoles(userId);
    return roles.some(r => r.name === roleName);
  }

  /**
   * Get role count
   */
  async getRoleCount(): Promise<number> {
    const result = await this.database.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM roles'
    );
    return parseInt(result?.count || '0');
  }

  /**
   * Clear cache for user
   */
  async clearCache(userId: string): Promise<void> {
    this.cache.delete(userId);
  }

  /**
   * Clear all cache
   */
  private clearAllCache(): void {
    this.cache.clear();
  }

  /**
   * Clean up expired role assignments
   */
  async cleanupExpiredAssignments(): Promise<number> {
    const result = await this.database.query(
      'DELETE FROM user_roles WHERE expires_at < CURRENT_TIMESTAMP'
    );

    if (result.rowCount > 0) {
      // Clear all cache as we don't know which users were affected
      this.clearAllCache();

      await this.eventBus.publish({
        eventType: 'ExpiredRolesCleanedUp',
        aggregateId: 'system',
        aggregateType: 'System',
        payload: {
          deletedCount: result.rowCount
        },
        metadata: {
          timestamp: new Date().toISOString()
        }
      });
    }

    return result.rowCount;
  }

  /**
   * Bulk assign roles
   */
  async bulkAssignRoles(
    assignments: Array<{
      userId: string;
      roleName: string;
      grantedBy?: string;
      expiresAt?: Date;
    }>
  ): Promise<void> {
    // Get all unique role names
    const roleNames = [...new Set(assignments.map(a => a.roleName))];
    
    // Fetch all roles
    const roles = await Promise.all(
      roleNames.map(name => this.getRoleByName(name))
    );
    
    const roleMap = new Map<string, string>();
    roles.forEach(role => {
      if (role) {
        roleMap.set(role.name, role.id);
      }
    });

    // Prepare bulk insert
    const values = assignments
      .filter(a => roleMap.has(a.roleName))
      .map(a => [
        a.userId,
        roleMap.get(a.roleName),
        a.grantedBy,
        a.expiresAt,
        {}
      ]);

    if (values.length > 0) {
      // Bulk insert
      const placeholders = values.map((_, index) => {
        const base = index * 5;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      }).join(', ');

      await this.database.query(
        `INSERT INTO user_roles (user_id, role_id, granted_by, expires_at, metadata)
         VALUES ${placeholders}
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        values.flat()
      );

      // Clear cache for all affected users
      assignments.forEach(a => this.clearCache(a.userId));
    }
  }
}