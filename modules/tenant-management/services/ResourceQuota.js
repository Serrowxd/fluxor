/**
 * Resource Quota - Tenant resource usage tracking and enforcement
 * @module tenant-management/services/ResourceQuota
 */

const EventEmitter = require('events');
const { RESOURCE_TYPES, TENANT_EVENTS, QUOTA_WARNING_THRESHOLDS } = require('../constants');

class ResourceQuota extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.usageCache = new Map();
    this.checkInterval = null;
  }

  /**
   * Start quota monitoring
   */
  startMonitoring() {
    if (this.checkInterval) {
      return;
    }

    const interval = this.config.quota?.checkInterval || 300000; // 5 minutes
    this.checkInterval = setInterval(() => {
      this._checkAllQuotas();
    }, interval);
  }

  /**
   * Stop quota monitoring
   */
  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check resource usage against limits
   * @param {string} tenantId - Tenant ID
   * @param {Object} limits - Resource limits
   * @returns {Promise<Object>} Usage check result
   */
  async checkUsage(tenantId, limits) {
    const usage = await this.getUsage(tenantId);
    const results = {};
    const violations = [];
    const warnings = [];

    for (const [resource, limit] of Object.entries(limits)) {
      const used = usage[resource] || 0;
      const percentage = limit > 0 ? used / limit : 0;
      const warningThreshold = QUOTA_WARNING_THRESHOLDS[resource] || 0.8;

      results[resource] = {
        used,
        limit,
        percentage,
        available: Math.max(0, limit - used),
        exceeded: used > limit,
        warning: percentage >= warningThreshold
      };

      if (used > limit) {
        violations.push({
          resource,
          used,
          limit,
          exceeded: used - limit
        });
      } else if (percentage >= warningThreshold) {
        warnings.push({
          resource,
          used,
          limit,
          percentage
        });
      }
    }

    const result = {
      tenantId,
      usage,
      limits,
      results,
      violations,
      warnings,
      checkedAt: new Date()
    };

    // Emit events for violations and warnings
    if (violations.length > 0) {
      this.emit(TENANT_EVENTS.LIMIT_EXCEEDED, { tenantId, violations });
    }
    if (warnings.length > 0) {
      this.emit(TENANT_EVENTS.QUOTA_WARNING, { tenantId, warnings });
    }

    return result;
  }

  /**
   * Get current resource usage
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} Resource usage
   */
  async getUsage(tenantId) {
    // Check cache first
    const cached = this.usageCache.get(tenantId);
    if (cached && Date.now() - cached.timestamp < 60000) { // 1 minute cache
      return cached.usage;
    }

    const usage = await this._fetchUsage(tenantId);
    this.usageCache.set(tenantId, {
      usage,
      timestamp: Date.now()
    });

    return usage;
  }

  /**
   * Update resource usage
   * @param {string} tenantId - Tenant ID
   * @param {string} resource - Resource type
   * @param {number} delta - Usage change
   * @returns {Promise<Object>} Updated usage
   */
  async updateUsage(tenantId, resource, delta) {
    const currentUsage = await this.getUsage(tenantId);
    const newValue = Math.max(0, (currentUsage[resource] || 0) + delta);
    
    await this._updateUsage(tenantId, resource, newValue);
    
    // Update cache
    if (this.usageCache.has(tenantId)) {
      const cached = this.usageCache.get(tenantId);
      cached.usage[resource] = newValue;
      cached.timestamp = Date.now();
    }

    return { [resource]: newValue };
  }

  /**
   * Reset resource usage
   * @param {string} tenantId - Tenant ID
   * @param {string} resource - Resource type (optional)
   * @returns {Promise<void>}
   */
  async resetUsage(tenantId, resource) {
    if (resource) {
      await this._updateUsage(tenantId, resource, 0);
    } else {
      // Reset all resources
      for (const res of Object.values(RESOURCE_TYPES)) {
        await this._updateUsage(tenantId, res, 0);
      }
    }

    // Clear cache
    this.usageCache.delete(tenantId);
  }

  /**
   * Enforce quota limits
   * @param {string} tenantId - Tenant ID
   * @param {string} resource - Resource type
   * @param {number} requested - Requested amount
   * @param {Object} limits - Resource limits
   * @returns {Promise<boolean>} Whether request is allowed
   */
  async enforceQuota(tenantId, resource, requested, limits) {
    const enforcementMode = this.config.quota?.enforcementMode || 'soft';
    const usage = await this.getUsage(tenantId);
    const currentUsage = usage[resource] || 0;
    const limit = limits[resource];

    if (!limit || limit === 0) {
      return true; // No limit set
    }

    const wouldExceed = currentUsage + requested > limit;

    if (wouldExceed) {
      if (enforcementMode === 'hard') {
        return false; // Deny request
      } else if (enforcementMode === 'soft') {
        // Check grace period
        const graceExpired = await this._checkGracePeriod(tenantId, resource);
        if (graceExpired) {
          return false; // Grace period expired, deny request
        }
      }
    }

    return true;
  }

  /**
   * Get usage statistics
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} Usage statistics
   */
  async getUsageStats(tenantId) {
    const usage = await this.getUsage(tenantId);
    const history = await this._fetchUsageHistory(tenantId, 30); // 30 days

    const stats = {
      current: usage,
      trends: {},
      projections: {}
    };

    // Calculate trends
    for (const resource of Object.keys(usage)) {
      const resourceHistory = history
        .map(h => ({ date: h.date, value: h.usage[resource] || 0 }))
        .sort((a, b) => a.date - b.date);

      if (resourceHistory.length >= 2) {
        const firstValue = resourceHistory[0].value;
        const lastValue = resourceHistory[resourceHistory.length - 1].value;
        const daysDiff = (resourceHistory[resourceHistory.length - 1].date - resourceHistory[0].date) / 86400000;
        
        stats.trends[resource] = {
          change: lastValue - firstValue,
          changePercent: firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0,
          dailyAverage: daysDiff > 0 ? (lastValue - firstValue) / daysDiff : 0
        };

        // Simple linear projection
        if (daysDiff > 0) {
          const dailyGrowth = (lastValue - firstValue) / daysDiff;
          stats.projections[resource] = {
            next7Days: Math.max(0, lastValue + (dailyGrowth * 7)),
            next30Days: Math.max(0, lastValue + (dailyGrowth * 30))
          };
        }
      }
    }

    return stats;
  }

  /**
   * Get quota summary for multiple tenants
   * @param {Array<string>} tenantIds - Tenant IDs
   * @returns {Promise<Array>} Quota summaries
   */
  async getQuotaSummaries(tenantIds) {
    const summaries = [];

    for (const tenantId of tenantIds) {
      const usage = await this.getUsage(tenantId);
      const summary = {
        tenantId,
        usage,
        status: 'healthy',
        issues: []
      };

      // Check for high usage
      for (const [resource, value] of Object.entries(usage)) {
        if (value > 0) {
          const warningThreshold = QUOTA_WARNING_THRESHOLDS[resource] || 0.8;
          // Note: This would need actual limits from tenant data
          // For now, using placeholder logic
          summary.issues.push({
            resource,
            severity: 'info',
            message: `Current usage: ${value}`
          });
        }
      }

      if (summary.issues.length > 0) {
        summary.status = 'warning';
      }

      summaries.push(summary);
    }

    return summaries;
  }

  /**
   * Check all tenant quotas
   * @private
   */
  async _checkAllQuotas() {
    // This would fetch all active tenants and check their quotas
    // Implementation depends on tenant service integration
  }

  /**
   * Fetch usage from database
   * @private
   */
  async _fetchUsage(tenantId) {
    // Database implementation
    // For now, returning mock data
    return {
      [RESOURCE_TYPES.USERS]: 0,
      [RESOURCE_TYPES.STORAGE]: 0,
      [RESOURCE_TYPES.API_CALLS]: 0,
      [RESOURCE_TYPES.PRODUCTS]: 0,
      [RESOURCE_TYPES.ORDERS]: 0
    };
  }

  /**
   * Update usage in database
   * @private
   */
  async _updateUsage(tenantId, resource, value) {
    // Database implementation
  }

  /**
   * Fetch usage history
   * @private
   */
  async _fetchUsageHistory(tenantId, days) {
    // Database implementation
    return [];
  }

  /**
   * Check grace period
   * @private
   */
  async _checkGracePeriod(tenantId, resource) {
    // Check if tenant has exceeded grace period for resource
    return false;
  }

  /**
   * Clear usage cache
   * @param {string} tenantId - Tenant ID (optional)
   */
  clearCache(tenantId) {
    if (tenantId) {
      this.usageCache.delete(tenantId);
    } else {
      this.usageCache.clear();
    }
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopMonitoring();
    this.usageCache.clear();
    this.removeAllListeners();
  }
}

module.exports = ResourceQuota;