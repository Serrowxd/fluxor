/**
 * Policy Service
 * Manages ABAC policies
 */

import { DatabaseService } from '../../../../infrastructure/database/src/services/database.service';
import { EventBusService } from '../../../event-bus/src/event-bus.service';

export interface PolicySubject {
  type: 'user' | 'role' | 'group' | 'authenticated' | 'anonymous';
  id?: string;
  attributes?: Record<string, any>;
}

export interface PolicyCondition {
  attribute: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'in' | 'not_in' | 'greater_than' | 'less_than';
  value: any;
}

export interface Policy {
  id: string;
  name: string;
  description?: string;
  effect: 'allow' | 'deny';
  subjects: PolicySubject[];
  resources: string[];
  actions: string[];
  conditions?: Record<string, any>;
  priority: number;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export class PolicyService {
  private policyCache = new Map<string, Policy[]>();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes
  private lastCacheUpdate = 0;

  constructor(
    private database: DatabaseService,
    private eventBus: EventBusService
  ) {}

  /**
   * Create a new policy
   */
  async createPolicy(policy: {
    name: string;
    description?: string;
    effect: 'allow' | 'deny';
    subjects: PolicySubject[];
    resources: string[];
    actions: string[];
    conditions?: Record<string, any>;
    priority?: number;
  }): Promise<Policy> {
    const result = await this.database.queryOne<Policy>(
      `INSERT INTO policies (
        name, description, effect, subjects, resources, 
        actions, conditions, priority
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        policy.name,
        policy.description,
        policy.effect,
        JSON.stringify(policy.subjects),
        JSON.stringify(policy.resources),
        JSON.stringify(policy.actions),
        policy.conditions || {},
        policy.priority || 0
      ]
    );

    if (!result) {
      throw new Error('Failed to create policy');
    }

    // Clear cache
    this.clearCache();

    await this.eventBus.publish({
      eventType: 'PolicyCreated',
      aggregateId: result.id,
      aggregateType: 'Policy',
      payload: result,
      metadata: {
        timestamp: new Date().toISOString()
      }
    });

    return result;
  }

  /**
   * Update a policy
   */
  async updatePolicy(
    policyId: string,
    updates: Partial<{
      description: string;
      effect: 'allow' | 'deny';
      subjects: PolicySubject[];
      resources: string[];
      actions: string[];
      conditions: Record<string, any>;
      priority: number;
      enabled: boolean;
    }>
  ): Promise<Policy> {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        setClauses.push(`${key} = $${paramIndex++}`);
        values.push(
          ['subjects', 'resources', 'actions', 'conditions'].includes(key)
            ? JSON.stringify(value)
            : value
        );
      }
    });

    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    values.push(policyId);

    const result = await this.database.queryOne<Policy>(
      `UPDATE policies 
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    if (!result) {
      throw new Error('Policy not found');
    }

    // Clear cache
    this.clearCache();

    await this.eventBus.publish({
      eventType: 'PolicyUpdated',
      aggregateId: policyId,
      aggregateType: 'Policy',
      payload: result,
      metadata: {
        timestamp: new Date().toISOString()
      }
    });

    return result;
  }

  /**
   * Delete a policy
   */
  async deletePolicy(policyId: string): Promise<void> {
    const result = await this.database.query(
      'DELETE FROM policies WHERE id = $1',
      [policyId]
    );

    if (result.rowCount === 0) {
      throw new Error('Policy not found');
    }

    // Clear cache
    this.clearCache();

    await this.eventBus.publish({
      eventType: 'PolicyDeleted',
      aggregateId: policyId,
      aggregateType: 'Policy',
      payload: { policyId },
      metadata: {
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Get policy by ID
   */
  async getPolicy(policyId: string): Promise<Policy | null> {
    const result = await this.database.queryOne<any>(
      'SELECT * FROM policies WHERE id = $1',
      [policyId]
    );

    if (!result) {
      return null;
    }

    return this.parsePolicy(result);
  }

  /**
   * Get policy by name
   */
  async getPolicyByName(name: string): Promise<Policy | null> {
    const result = await this.database.queryOne<any>(
      'SELECT * FROM policies WHERE name = $1',
      [name]
    );

    if (!result) {
      return null;
    }

    return this.parsePolicy(result);
  }

  /**
   * Get all enabled policies
   */
  async getEnabledPolicies(): Promise<Policy[]> {
    // Check cache
    if (Date.now() - this.lastCacheUpdate < this.cacheTimeout) {
      const cached = this.policyCache.get('enabled');
      if (cached) {
        return cached;
      }
    }

    const results = await this.database.queryMany<any>(
      'SELECT * FROM policies WHERE enabled = true ORDER BY priority DESC, created_at ASC'
    );

    const policies = results.map(r => this.parsePolicy(r));

    // Update cache
    this.policyCache.set('enabled', policies);
    this.lastCacheUpdate = Date.now();

    return policies;
  }

  /**
   * Get policies for evaluation
   */
  async getPoliciesForEvaluation(
    subjects: PolicySubject[],
    resource: string,
    action: string
  ): Promise<Policy[]> {
    const allPolicies = await this.getEnabledPolicies();
    
    return allPolicies.filter(policy => {
      // Check if any subject matches
      const subjectMatches = policy.subjects.some(policySubject => 
        this.subjectMatches(policySubject, subjects)
      );
      
      if (!subjectMatches) return false;

      // Check if resource matches
      const resourceMatches = policy.resources.some(policyResource =>
        this.resourceMatches(policyResource, resource)
      );
      
      if (!resourceMatches) return false;

      // Check if action matches
      const actionMatches = policy.actions.some(policyAction =>
        this.actionMatches(policyAction, action)
      );

      return actionMatches;
    });
  }

  /**
   * Get policy count
   */
  async getPolicyCount(): Promise<number> {
    const result = await this.database.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM policies WHERE enabled = true'
    );
    return parseInt(result?.count || '0');
  }

  /**
   * Enable/disable policy
   */
  async setPolicy
(policyId: string, enabled: boolean): Promise<void> {
    await this.updatePolicy(policyId, { enabled });
  }

  /**
   * Parse policy from database
   */
  private parsePolicy(raw: any): Policy {
    return {
      ...raw,
      subjects: typeof raw.subjects === 'string' ? JSON.parse(raw.subjects) : raw.subjects,
      resources: typeof raw.resources === 'string' ? JSON.parse(raw.resources) : raw.resources,
      actions: typeof raw.actions === 'string' ? JSON.parse(raw.actions) : raw.actions,
      conditions: typeof raw.conditions === 'string' ? JSON.parse(raw.conditions) : raw.conditions
    };
  }

  /**
   * Check if subject matches
   */
  private subjectMatches(
    policySubject: PolicySubject,
    userSubjects: PolicySubject[]
  ): boolean {
    // Handle wildcard subjects
    if (policySubject.type === 'authenticated') {
      return userSubjects.some(s => s.type === 'user' && s.id);
    }
    
    if (policySubject.type === 'anonymous') {
      return userSubjects.some(s => s.type === 'anonymous');
    }

    // Check exact match
    return userSubjects.some(userSubject => {
      if (policySubject.type !== userSubject.type) return false;
      
      if (policySubject.id && policySubject.id !== userSubject.id) {
        // Check for variable substitution
        if (policySubject.id.includes('${')) {
          // This would be evaluated by the policy engine
          return true;
        }
        return false;
      }

      return true;
    });
  }

  /**
   * Check if resource matches
   */
  private resourceMatches(policyResource: string, resource: string): boolean {
    // Handle wildcards
    if (policyResource === '*') return true;
    
    // Handle prefix matching
    if (policyResource.endsWith('*')) {
      const prefix = policyResource.slice(0, -1);
      return resource.startsWith(prefix);
    }
    
    // Handle variable substitution
    if (policyResource.includes('${')) {
      // This would be evaluated by the policy engine
      return true;
    }
    
    // Exact match
    return policyResource === resource;
  }

  /**
   * Check if action matches
   */
  private actionMatches(policyAction: string, action: string): boolean {
    // Handle wildcards
    if (policyAction === '*') return true;
    
    // Handle prefix matching
    if (policyAction.endsWith('*')) {
      const prefix = policyAction.slice(0, -1);
      return action.startsWith(prefix);
    }
    
    // Exact match
    return policyAction === action;
  }

  /**
   * Clear cache
   */
  private clearCache(): void {
    this.policyCache.clear();
    this.lastCacheUpdate = 0;
  }

  /**
   * Validate policy
   */
  validatePolicy(policy: Partial<Policy>): string[] {
    const errors: string[] = [];

    if (!policy.name) {
      errors.push('Policy name is required');
    }

    if (!policy.effect || !['allow', 'deny'].includes(policy.effect)) {
      errors.push('Policy effect must be either "allow" or "deny"');
    }

    if (!policy.subjects || policy.subjects.length === 0) {
      errors.push('At least one subject is required');
    }

    if (!policy.resources || policy.resources.length === 0) {
      errors.push('At least one resource is required');
    }

    if (!policy.actions || policy.actions.length === 0) {
      errors.push('At least one action is required');
    }

    return errors;
  }

  /**
   * Import policies from JSON
   */
  async importPolicies(policies: Partial<Policy>[]): Promise<{
    imported: number;
    errors: Array<{ policy: string; error: string }>;
  }> {
    let imported = 0;
    const errors: Array<{ policy: string; error: string }> = [];

    for (const policy of policies) {
      try {
        const validationErrors = this.validatePolicy(policy);
        if (validationErrors.length > 0) {
          errors.push({
            policy: policy.name || 'unknown',
            error: validationErrors.join(', ')
          });
          continue;
        }

        await this.createPolicy(policy as any);
        imported++;
      } catch (error) {
        errors.push({
          policy: policy.name || 'unknown',
          error: error.message
        });
      }
    }

    return { imported, errors };
  }

  /**
   * Export policies
   */
  async exportPolicies(): Promise<Partial<Policy>[]> {
    const policies = await this.database.queryMany<any>(
      'SELECT * FROM policies ORDER BY name'
    );

    return policies.map(p => ({
      name: p.name,
      description: p.description,
      effect: p.effect,
      subjects: this.parsePolicy(p).subjects,
      resources: this.parsePolicy(p).resources,
      actions: this.parsePolicy(p).actions,
      conditions: this.parsePolicy(p).conditions,
      priority: p.priority
    }));
  }
}