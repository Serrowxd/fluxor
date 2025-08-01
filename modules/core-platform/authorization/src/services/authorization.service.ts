/**
 * Authorization Service
 * Main service for handling authorization checks
 */

import { RoleService } from './role.service';
import { PermissionService } from './permission.service';
import { PolicyEngine } from './policy-engine.service';
import { EventBusService } from '../../../event-bus/src/event-bus.service';

export interface AuthorizationContext {
  user: {
    id: string;
    roles?: string[];
    attributes?: Record<string, any>;
  };
  resource: {
    type: string;
    id?: string;
    attributes?: Record<string, any>;
  };
  action: string;
  environment?: Record<string, any>;
}

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
  matchedPolicies?: string[];
  requiredPermissions?: string[];
}

export class AuthorizationService {
  constructor(
    private roleService: RoleService,
    private permissionService: PermissionService,
    private policyEngine: PolicyEngine,
    private eventBus: EventBusService
  ) {}

  /**
   * Check if a user is authorized to perform an action on a resource
   */
  async authorize(context: AuthorizationContext): Promise<AuthorizationResult> {
    const startTime = Date.now();

    try {
      // Step 1: Get user's roles if not provided
      if (!context.user.roles) {
        const userRoles = await this.roleService.getUserRoles(context.user.id);
        context.user.roles = userRoles.map(r => r.name);
      }

      // Step 2: Check RBAC permissions
      const rbacResult = await this.checkRBACPermissions(context);
      if (rbacResult.allowed) {
        await this.logAuthorizationEvent(context, rbacResult, Date.now() - startTime);
        return rbacResult;
      }

      // Step 3: Check ABAC policies
      const abacResult = await this.policyEngine.evaluate(context);
      
      // Combine results
      const finalResult: AuthorizationResult = {
        allowed: rbacResult.allowed || abacResult.allowed,
        reason: abacResult.allowed ? abacResult.reason : rbacResult.reason,
        matchedPolicies: abacResult.matchedPolicies,
        requiredPermissions: rbacResult.requiredPermissions
      };

      await this.logAuthorizationEvent(context, finalResult, Date.now() - startTime);
      return finalResult;
    } catch (error) {
      console.error('Authorization error:', error);
      
      const errorResult: AuthorizationResult = {
        allowed: false,
        reason: 'Authorization check failed due to error'
      };
      
      await this.logAuthorizationEvent(context, errorResult, Date.now() - startTime, error);
      return errorResult;
    }
  }

  /**
   * Check if user has specific permission
   */
  async hasPermission(
    userId: string,
    resource: string,
    action: string
  ): Promise<boolean> {
    const result = await this.authorize({
      user: { id: userId },
      resource: { type: resource },
      action
    });
    
    return result.allowed;
  }

  /**
   * Check if user has specific role
   */
  async hasRole(userId: string, roleName: string): Promise<boolean> {
    const roles = await this.roleService.getUserRoles(userId);
    return roles.some(r => r.name === roleName);
  }

  /**
   * Check if user has any of the specified roles
   */
  async hasAnyRole(userId: string, roleNames: string[]): Promise<boolean> {
    const roles = await this.roleService.getUserRoles(userId);
    return roles.some(r => roleNames.includes(r.name));
  }

  /**
   * Check if user has all of the specified roles
   */
  async hasAllRoles(userId: string, roleNames: string[]): Promise<boolean> {
    const roles = await this.roleService.getUserRoles(userId);
    const userRoleNames = roles.map(r => r.name);
    return roleNames.every(roleName => userRoleNames.includes(roleName));
  }

  /**
   * Grant role to user
   */
  async grantRole(
    userId: string,
    roleName: string,
    grantedBy: string,
    expiresAt?: Date
  ): Promise<void> {
    await this.roleService.assignRole(userId, roleName, grantedBy, expiresAt);
    
    await this.eventBus.publish({
      eventType: 'RoleGranted',
      aggregateId: userId,
      aggregateType: 'User',
      payload: {
        userId,
        roleName,
        grantedBy,
        expiresAt
      },
      metadata: {
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Revoke role from user
   */
  async revokeRole(userId: string, roleName: string, revokedBy: string): Promise<void> {
    await this.roleService.removeRole(userId, roleName);
    
    await this.eventBus.publish({
      eventType: 'RoleRevoked',
      aggregateId: userId,
      aggregateType: 'User',
      payload: {
        userId,
        roleName,
        revokedBy
      },
      metadata: {
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Check RBAC permissions
   */
  private async checkRBACPermissions(
    context: AuthorizationContext
  ): Promise<AuthorizationResult> {
    // Get permissions for user's roles
    const permissions = await this.permissionService.getPermissionsForRoles(
      context.user.roles || []
    );

    // Check if any permission matches
    const requiredPermission = `${context.resource.type}:${context.action}`;
    const hasPermission = permissions.some(p => {
      // Check exact match
      if (p === requiredPermission) return true;
      
      // Check wildcard permissions
      if (p === '*:*' || p === `*:${context.action}` || p === `${context.resource.type}:*`) {
        return true;
      }
      
      return false;
    });

    return {
      allowed: hasPermission,
      reason: hasPermission 
        ? 'Permission granted through role'
        : 'No matching permission found',
      requiredPermissions: [requiredPermission]
    };
  }

  /**
   * Log authorization event
   */
  private async logAuthorizationEvent(
    context: AuthorizationContext,
    result: AuthorizationResult,
    duration: number,
    error?: any
  ): Promise<void> {
    await this.eventBus.publish({
      eventType: 'AuthorizationChecked',
      aggregateId: context.user.id,
      aggregateType: 'User',
      payload: {
        userId: context.user.id,
        resource: context.resource,
        action: context.action,
        result: result.allowed,
        reason: result.reason,
        duration,
        error: error?.message
      },
      metadata: {
        timestamp: new Date().toISOString(),
        userRoles: context.user.roles,
        matchedPolicies: result.matchedPolicies
      }
    });
  }

  /**
   * Clear authorization cache for user
   */
  async clearUserCache(userId: string): Promise<void> {
    // Clear role cache
    await this.roleService.clearCache(userId);
    
    // Clear policy cache
    await this.policyEngine.clearCache(userId);
    
    await this.eventBus.publish({
      eventType: 'AuthorizationCacheCleared',
      aggregateId: userId,
      aggregateType: 'User',
      payload: { userId },
      metadata: {
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Bulk authorization check
   */
  async authorizeBulk(
    contexts: AuthorizationContext[]
  ): Promise<Map<number, AuthorizationResult>> {
    const results = new Map<number, AuthorizationResult>();
    
    // Process in parallel for performance
    const promises = contexts.map(async (context, index) => {
      const result = await this.authorize(context);
      results.set(index, result);
    });
    
    await Promise.all(promises);
    
    return results;
  }

  /**
   * Get effective permissions for user
   */
  async getEffectivePermissions(userId: string): Promise<string[]> {
    const roles = await this.roleService.getUserRoles(userId);
    const roleNames = roles.map(r => r.name);
    return await this.permissionService.getPermissionsForRoles(roleNames);
  }
}