/**
 * Policy Engine Service
 * Evaluates ABAC policies with condition evaluation
 */

import { PolicyService, Policy, PolicySubject } from './policy.service';
import { AuthorizationContext, AuthorizationResult } from './authorization.service';

export class PolicyEngine {
  private evaluationCache = new Map<string, { result: AuthorizationResult; timestamp: number }>();
  private cacheTimeout = 60 * 1000; // 1 minute

  constructor(private policyService: PolicyService) {}

  /**
   * Evaluate policies for authorization context
   */
  async evaluate(context: AuthorizationContext): Promise<AuthorizationResult> {
    // Check cache
    const cacheKey = this.getCacheKey(context);
    const cached = this.evaluationCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.result;
    }

    // Convert context to policy subjects
    const subjects: PolicySubject[] = [
      { type: 'user', id: context.user.id, attributes: context.user.attributes }
    ];

    if (context.user.roles) {
      context.user.roles.forEach(role => {
        subjects.push({ type: 'role', id: role });
      });
    }

    if (context.user.id) {
      subjects.push({ type: 'authenticated' });
    } else {
      subjects.push({ type: 'anonymous' });
    }

    // Get applicable policies
    const policies = await this.policyService.getPoliciesForEvaluation(
      subjects,
      context.resource.type,
      context.action
    );

    // Evaluate policies in priority order
    let result: AuthorizationResult = {
      allowed: false,
      reason: 'No matching policies found',
      matchedPolicies: []
    };

    for (const policy of policies) {
      const policyResult = await this.evaluatePolicy(policy, context);
      
      if (policyResult.matches) {
        result.matchedPolicies = result.matchedPolicies || [];
        result.matchedPolicies.push(policy.name);

        if (policy.effect === 'deny') {
          // Deny takes precedence
          result.allowed = false;
          result.reason = `Denied by policy: ${policy.name}`;
          break;
        } else if (policy.effect === 'allow') {
          result.allowed = true;
          result.reason = `Allowed by policy: ${policy.name}`;
          // Continue checking for deny policies
        }
      }
    }

    // Update cache
    this.evaluationCache.set(cacheKey, { result, timestamp: Date.now() });

    return result;
  }

  /**
   * Evaluate a single policy
   */
  private async evaluatePolicy(
    policy: Policy,
    context: AuthorizationContext
  ): Promise<{ matches: boolean; reason?: string }> {
    // Check conditions
    if (policy.conditions && Object.keys(policy.conditions).length > 0) {
      const conditionsMatch = await this.evaluateConditions(
        policy.conditions,
        context
      );

      if (!conditionsMatch) {
        return { matches: false, reason: 'Conditions not met' };
      }
    }

    // Check resource with variable substitution
    const resourceMatches = policy.resources.some(resource => {
      const expanded = this.expandVariables(resource, context);
      return this.matchResource(expanded, context.resource);
    });

    if (!resourceMatches) {
      return { matches: false, reason: 'Resource does not match' };
    }

    return { matches: true };
  }

  /**
   * Evaluate policy conditions
   */
  private async evaluateConditions(
    conditions: Record<string, any>,
    context: AuthorizationContext
  ): Promise<boolean> {
    for (const [key, condition] of Object.entries(conditions)) {
      if (!await this.evaluateCondition(key, condition, context)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Evaluate a single condition
   */
  private async evaluateCondition(
    key: string,
    condition: any,
    context: AuthorizationContext
  ): Promise<boolean> {
    // Handle different condition types
    if (typeof condition === 'object' && condition !== null) {
      // Complex condition with operator
      const { operator, value } = condition;
      const contextValue = this.getValueFromContext(key, context);

      switch (operator) {
        case 'equals':
          return contextValue === value;
        case 'not_equals':
          return contextValue !== value;
        case 'contains':
          return Array.isArray(contextValue) && contextValue.includes(value);
        case 'not_contains':
          return Array.isArray(contextValue) && !contextValue.includes(value);
        case 'in':
          return Array.isArray(value) && value.includes(contextValue);
        case 'not_in':
          return Array.isArray(value) && !value.includes(contextValue);
        case 'greater_than':
          return contextValue > value;
        case 'less_than':
          return contextValue < value;
        case 'matches':
          return new RegExp(value).test(contextValue);
        default:
          return false;
      }
    } else {
      // Simple equality check
      const contextValue = this.getValueFromContext(key, context);
      return contextValue === condition;
    }
  }

  /**
   * Get value from context using dot notation
   */
  private getValueFromContext(path: string, context: AuthorizationContext): any {
    const parts = path.split('.');
    let current: any = context;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Expand variables in strings
   */
  private expandVariables(template: string, context: AuthorizationContext): string {
    return template.replace(/\${([^}]+)}/g, (match, path) => {
      const value = this.getValueFromContext(path, context);
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Match resource patterns
   */
  private matchResource(
    pattern: string,
    resource: { type: string; id?: string }
  ): boolean {
    // Handle wildcards
    if (pattern === '*') return true;

    // Handle resource type with optional ID
    const [patternType, patternId] = pattern.split(':');
    
    if (patternType !== resource.type && patternType !== '*') {
      return false;
    }

    if (patternId && resource.id) {
      if (patternId === '*') return true;
      if (patternId === resource.id) return true;
      
      // Handle glob patterns
      if (patternId.includes('*')) {
        const regex = new RegExp('^' + patternId.replace(/\*/g, '.*') + '$');
        return regex.test(resource.id);
      }
    }

    return !patternId || !resource.id;
  }

  /**
   * Generate cache key
   */
  private getCacheKey(context: AuthorizationContext): string {
    return `${context.user.id}:${context.resource.type}:${context.resource.id}:${context.action}`;
  }

  /**
   * Clear cache for user
   */
  async clearCache(userId?: string): Promise<void> {
    if (userId) {
      // Clear entries for specific user
      for (const [key] of this.evaluationCache.entries()) {
        if (key.startsWith(`${userId}:`)) {
          this.evaluationCache.delete(key);
        }
      }
    } else {
      // Clear all cache
      this.evaluationCache.clear();
    }
  }

  /**
   * Explain policy evaluation
   */
  async explain(context: AuthorizationContext): Promise<{
    result: AuthorizationResult;
    evaluation: Array<{
      policy: string;
      effect: 'allow' | 'deny';
      matches: boolean;
      reason?: string;
      conditionResults?: Record<string, boolean>;
    }>;
  }> {
    const subjects: PolicySubject[] = [
      { type: 'user', id: context.user.id, attributes: context.user.attributes }
    ];

    if (context.user.roles) {
      context.user.roles.forEach(role => {
        subjects.push({ type: 'role', id: role });
      });
    }

    const policies = await this.policyService.getPoliciesForEvaluation(
      subjects,
      context.resource.type,
      context.action
    );

    const evaluation: any[] = [];
    let finalResult: AuthorizationResult = {
      allowed: false,
      reason: 'No matching policies found',
      matchedPolicies: []
    };

    for (const policy of policies) {
      const policyResult = await this.evaluatePolicy(policy, context);
      const conditionResults: Record<string, boolean> = {};

      if (policy.conditions) {
        for (const [key, condition] of Object.entries(policy.conditions)) {
          conditionResults[key] = await this.evaluateCondition(key, condition, context);
        }
      }

      evaluation.push({
        policy: policy.name,
        effect: policy.effect,
        matches: policyResult.matches,
        reason: policyResult.reason,
        conditionResults: Object.keys(conditionResults).length > 0 ? conditionResults : undefined
      });

      if (policyResult.matches) {
        finalResult.matchedPolicies?.push(policy.name);

        if (policy.effect === 'deny') {
          finalResult.allowed = false;
          finalResult.reason = `Denied by policy: ${policy.name}`;
          break;
        } else if (policy.effect === 'allow') {
          finalResult.allowed = true;
          finalResult.reason = `Allowed by policy: ${policy.name}`;
        }
      }
    }

    return { result: finalResult, evaluation };
  }

  /**
   * Validate policy syntax
   */
  async validatePolicy(policy: any): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Validate conditions
    if (policy.conditions) {
      for (const [key, condition] of Object.entries(policy.conditions)) {
        if (typeof condition === 'object' && condition !== null) {
          if (!condition.operator) {
            errors.push(`Condition '${key}' missing operator`);
          }
          if (condition.value === undefined) {
            errors.push(`Condition '${key}' missing value`);
          }
        }
      }
    }

    // Validate resource patterns
    if (policy.resources) {
      for (const resource of policy.resources) {
        if (typeof resource !== 'string') {
          errors.push('Resource must be a string');
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}