/**
 * Tenant Isolation - Data isolation and access control
 * @module tenant-management/services/TenantIsolation
 */

const { ISOLATION_STRATEGIES } = require('../constants');

class TenantIsolation {
  constructor(config = {}) {
    this.config = config;
    this.strategy = config.isolation?.strategy || ISOLATION_STRATEGIES.SCHEMA;
    this.connectionPools = new Map();
    this.contextStorage = new Map();
  }

  /**
   * Set tenant context for current execution
   * @param {Object} context - Tenant context
   */
  setContext(context) {
    const asyncId = this._getAsyncId();
    this.contextStorage.set(asyncId, {
      tenantId: context.tenantId,
      userId: context.userId,
      permissions: context.permissions,
      limits: context.limits,
      dataPartition: this._getDataPartition(context.tenantId)
    });
  }

  /**
   * Get current tenant context
   * @returns {Object|null} Current context
   */
  getContext() {
    const asyncId = this._getAsyncId();
    return this.contextStorage.get(asyncId) || null;
  }

  /**
   * Clear tenant context
   */
  clearContext() {
    const asyncId = this._getAsyncId();
    this.contextStorage.delete(asyncId);
  }

  /**
   * Execute function in tenant context
   * @param {Object} context - Tenant context
   * @param {Function} fn - Function to execute
   * @returns {Promise<any>} Function result
   */
  async executeInContext(context, fn) {
    this.setContext(context);
    try {
      return await fn();
    } finally {
      this.clearContext();
    }
  }

  /**
   * Get database connection for tenant
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} Database connection
   */
  async getConnection(tenantId) {
    switch (this.strategy) {
      case ISOLATION_STRATEGIES.DATABASE:
        return this._getDatabaseConnection(tenantId);
      
      case ISOLATION_STRATEGIES.SCHEMA:
        return this._getSchemaConnection(tenantId);
      
      case ISOLATION_STRATEGIES.ROW_LEVEL:
        return this._getRowLevelConnection(tenantId);
      
      case ISOLATION_STRATEGIES.PARTITION:
        return this._getPartitionConnection(tenantId);
      
      default:
        throw new Error(`Unknown isolation strategy: ${this.strategy}`);
    }
  }

  /**
   * Apply tenant filter to query
   * @param {Object} query - Database query
   * @param {string} tenantId - Tenant ID
   * @returns {Object} Modified query
   */
  applyTenantFilter(query, tenantId) {
    const context = this.getContext();
    const effectiveTenantId = tenantId || context?.tenantId;

    if (!effectiveTenantId) {
      throw new Error('No tenant context available');
    }

    switch (this.strategy) {
      case ISOLATION_STRATEGIES.ROW_LEVEL:
        return this._applyRowLevelFilter(query, effectiveTenantId);
      
      case ISOLATION_STRATEGIES.PARTITION:
        return this._applyPartitionFilter(query, effectiveTenantId);
      
      default:
        // For database and schema isolation, filtering is handled at connection level
        return query;
    }
  }

  /**
   * Validate cross-tenant access
   * @param {string} sourceTenantId - Source tenant
   * @param {string} targetTenantId - Target tenant
   * @param {string} operation - Operation type
   * @returns {boolean} Access allowed
   */
  validateCrossTenantAccess(sourceTenantId, targetTenantId, operation) {
    // By default, cross-tenant access is not allowed
    if (sourceTenantId !== targetTenantId) {
      const context = this.getContext();
      
      // Check if user has cross-tenant permissions
      if (context?.permissions?.includes('system:cross-tenant')) {
        return true;
      }
      
      return false;
    }
    
    return true;
  }

  /**
   * Create tenant isolation resources
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<void>}
   */
  async createTenantResources(tenantId) {
    switch (this.strategy) {
      case ISOLATION_STRATEGIES.DATABASE:
        await this._createTenantDatabase(tenantId);
        break;
      
      case ISOLATION_STRATEGIES.SCHEMA:
        await this._createTenantSchema(tenantId);
        break;
      
      case ISOLATION_STRATEGIES.PARTITION:
        await this._createTenantPartition(tenantId);
        break;
      
      // Row-level doesn't require special resources
    }
  }

  /**
   * Remove tenant isolation resources
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<void>}
   */
  async removeTenantResources(tenantId) {
    switch (this.strategy) {
      case ISOLATION_STRATEGIES.DATABASE:
        await this._removeTenantDatabase(tenantId);
        break;
      
      case ISOLATION_STRATEGIES.SCHEMA:
        await this._removeTenantSchema(tenantId);
        break;
      
      case ISOLATION_STRATEGIES.PARTITION:
        await this._removeTenantPartition(tenantId);
        break;
    }

    // Clean up connection pool
    if (this.connectionPools.has(tenantId)) {
      const pool = this.connectionPools.get(tenantId);
      await pool.end();
      this.connectionPools.delete(tenantId);
    }
  }

  /**
   * Get data partition for tenant
   * @private
   */
  _getDataPartition(tenantId) {
    // Simple hash-based partitioning
    const hash = this._hashString(tenantId);
    const partitionCount = this.config.partitionCount || 16;
    return `partition_${hash % partitionCount}`;
  }

  /**
   * Database isolation connection
   * @private
   */
  async _getDatabaseConnection(tenantId) {
    if (!this.connectionPools.has(tenantId)) {
      // Create new connection pool for tenant database
      const pool = await this._createConnectionPool({
        ...this.config.database,
        database: `${this.config.database.database}_${tenantId}`
      });
      this.connectionPools.set(tenantId, pool);
    }
    return this.connectionPools.get(tenantId);
  }

  /**
   * Schema isolation connection
   * @private
   */
  async _getSchemaConnection(tenantId) {
    const pool = await this._getSharedConnectionPool();
    // Set search path to tenant schema
    return {
      ...pool,
      schema: `tenant_${tenantId}`,
      query: async (text, params) => {
        const client = await pool.connect();
        try {
          await client.query(`SET search_path TO tenant_${tenantId}, public`);
          return await client.query(text, params);
        } finally {
          client.release();
        }
      }
    };
  }

  /**
   * Row-level isolation connection
   * @private
   */
  async _getRowLevelConnection(tenantId) {
    return await this._getSharedConnectionPool();
  }

  /**
   * Partition isolation connection
   * @private
   */
  async _getPartitionConnection(tenantId) {
    const pool = await this._getSharedConnectionPool();
    const partition = this._getDataPartition(tenantId);
    return {
      ...pool,
      partition
    };
  }

  /**
   * Apply row-level security filter
   * @private
   */
  _applyRowLevelFilter(query, tenantId) {
    // Add tenant_id condition to WHERE clause
    if (typeof query === 'object' && query.where) {
      query.where.tenant_id = tenantId;
    }
    return query;
  }

  /**
   * Apply partition filter
   * @private
   */
  _applyPartitionFilter(query, tenantId) {
    const partition = this._getDataPartition(tenantId);
    // Modify table name to include partition
    if (typeof query === 'object' && query.table) {
      query.table = `${query.table}_${partition}`;
    }
    return query;
  }

  /**
   * Get shared connection pool
   * @private
   */
  async _getSharedConnectionPool() {
    if (!this.connectionPools.has('shared')) {
      const pool = await this._createConnectionPool(this.config.database);
      this.connectionPools.set('shared', pool);
    }
    return this.connectionPools.get('shared');
  }

  /**
   * Create connection pool
   * @private
   */
  async _createConnectionPool(config) {
    // Database-specific pool creation
    // This is a placeholder - actual implementation would use pg, mysql, etc.
    return {
      connect: async () => ({}),
      query: async (text, params) => ({ rows: [] }),
      end: async () => {}
    };
  }

  /**
   * Create tenant database
   * @private
   */
  async _createTenantDatabase(tenantId) {
    // CREATE DATABASE implementation
  }

  /**
   * Create tenant schema
   * @private
   */
  async _createTenantSchema(tenantId) {
    // CREATE SCHEMA implementation
  }

  /**
   * Create tenant partition
   * @private
   */
  async _createTenantPartition(tenantId) {
    // CREATE PARTITION implementation
  }

  /**
   * Remove tenant database
   * @private
   */
  async _removeTenantDatabase(tenantId) {
    // DROP DATABASE implementation
  }

  /**
   * Remove tenant schema
   * @private
   */
  async _removeTenantSchema(tenantId) {
    // DROP SCHEMA implementation
  }

  /**
   * Remove tenant partition
   * @private
   */
  async _removeTenantPartition(tenantId) {
    // DROP PARTITION implementation
  }

  /**
   * Hash string to number
   * @private
   */
  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Get async context ID
   * @private
   */
  _getAsyncId() {
    // In real implementation, would use async_hooks or cls-hooked
    return 'default';
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    for (const [id, pool] of this.connectionPools) {
      await pool.end();
    }
    this.connectionPools.clear();
    this.contextStorage.clear();
  }
}

module.exports = TenantIsolation;