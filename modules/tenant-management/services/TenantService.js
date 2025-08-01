/**
 * Tenant Service - Core tenant management operations
 * @module tenant-management/services/TenantService
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const slugify = require('slugify');
const { TENANT_STATUS, TENANT_EVENTS } = require('../constants');

class TenantService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.database = config.database;
    this.cache = new Map();
  }

  /**
   * Create a new tenant
   * @param {Object} tenantData - Tenant data
   * @returns {Promise<Object>} Created tenant
   */
  async createTenant(tenantData) {
    const tenant = {
      id: tenantData.id || uuidv4(),
      name: tenantData.name,
      slug: tenantData.slug || slugify(tenantData.name, { lower: true }),
      status: TENANT_STATUS.PROVISIONING,
      settings: {
        ...this.config.defaults.settings,
        ...tenantData.settings
      },
      features: {
        ...this.config.defaults.features,
        ...tenantData.features
      },
      limits: {
        ...this.config.defaults.limits,
        ...tenantData.limits
      },
      metadata: tenantData.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Set trial expiration if enabled
    if (this.config.defaults.trial.enabled && !tenantData.skipTrial) {
      tenant.trialEndsAt = new Date(Date.now() + this.config.defaults.trial.duration * 86400000);
      tenant.limits = { ...tenant.limits, ...this.config.defaults.trial.limits };
    }

    // Validate unique slug
    const existingTenant = await this.getTenantBySlug(tenant.slug);
    if (existingTenant) {
      throw new Error(`Tenant with slug '${tenant.slug}' already exists`);
    }

    // Save to database
    await this._saveTenant(tenant);
    
    // Initialize tenant resources
    await this._provisionTenantResources(tenant);
    
    // Update status to active
    tenant.status = TENANT_STATUS.ACTIVE;
    await this._updateTenant(tenant);

    this.emit(TENANT_EVENTS.CREATED, { tenant });
    return tenant;
  }

  /**
   * Get tenant by ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object|null>} Tenant
   */
  async getTenant(tenantId) {
    // Check cache first
    if (this.cache.has(tenantId)) {
      return this.cache.get(tenantId);
    }

    const tenant = await this._loadTenant(tenantId);
    if (tenant) {
      this.cache.set(tenantId, tenant);
    }
    return tenant;
  }

  /**
   * Get tenant by slug
   * @param {string} slug - Tenant slug
   * @returns {Promise<Object|null>} Tenant
   */
  async getTenantBySlug(slug) {
    return await this._loadTenantBySlug(slug);
  }

  /**
   * Update tenant
   * @param {string} tenantId - Tenant ID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} Updated tenant
   */
  async updateTenant(tenantId, updates) {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    // Apply updates
    const updatedTenant = {
      ...tenant,
      ...updates,
      id: tenant.id, // Prevent ID change
      createdAt: tenant.createdAt, // Preserve creation date
      updatedAt: new Date()
    };

    // Validate slug uniqueness if changed
    if (updates.slug && updates.slug !== tenant.slug) {
      const existingTenant = await this.getTenantBySlug(updates.slug);
      if (existingTenant) {
        throw new Error(`Tenant with slug '${updates.slug}' already exists`);
      }
    }

    await this._updateTenant(updatedTenant);
    this.cache.set(tenantId, updatedTenant);

    this.emit(TENANT_EVENTS.UPDATED, { tenant: updatedTenant, changes: updates });
    return updatedTenant;
  }

  /**
   * Suspend a tenant
   * @param {string} tenantId - Tenant ID
   * @param {string} reason - Suspension reason
   * @returns {Promise<Object>} Updated tenant
   */
  async suspendTenant(tenantId, reason) {
    const tenant = await this.updateTenant(tenantId, {
      status: TENANT_STATUS.SUSPENDED,
      suspendedAt: new Date(),
      suspensionReason: reason
    });

    this.emit(TENANT_EVENTS.SUSPENDED, { tenant, reason });
    return tenant;
  }

  /**
   * Activate a tenant
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} Updated tenant
   */
  async activateTenant(tenantId) {
    const tenant = await this.updateTenant(tenantId, {
      status: TENANT_STATUS.ACTIVE,
      suspendedAt: null,
      suspensionReason: null
    });

    this.emit(TENANT_EVENTS.ACTIVATED, { tenant });
    return tenant;
  }

  /**
   * Terminate a tenant
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} Updated tenant
   */
  async terminateTenant(tenantId) {
    const tenant = await this.updateTenant(tenantId, {
      status: TENANT_STATUS.TERMINATED,
      terminatedAt: new Date()
    });

    // Schedule data archival
    await this._scheduleTenantArchival(tenant);

    this.emit(TENANT_EVENTS.TERMINATED, { tenant });
    return tenant;
  }

  /**
   * List tenants
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Array>} List of tenants
   */
  async listTenants(filters = {}) {
    return await this._queryTenants(filters);
  }

  /**
   * Add user to tenant
   * @param {string} tenantId - Tenant ID
   * @param {string} userId - User ID
   * @param {Array} roles - User roles
   * @returns {Promise<Object>} Tenant user
   */
  async addUser(tenantId, userId, roles = ['member']) {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    const tenantUser = {
      userId,
      tenantId,
      roles,
      joinedAt: new Date(),
      status: 'active'
    };

    await this._saveTenantUser(tenantUser);
    this.emit(TENANT_EVENTS.USER_ADDED, { tenant, userId, roles });
    
    return tenantUser;
  }

  /**
   * Remove user from tenant
   * @param {string} tenantId - Tenant ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success
   */
  async removeUser(tenantId, userId) {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    await this._removeTenantUser(tenantId, userId);
    this.emit(TENANT_EVENTS.USER_REMOVED, { tenant, userId });
    
    return true;
  }

  /**
   * Get tenant users
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Array>} Tenant users
   */
  async getTenantUsers(tenantId) {
    return await this._loadTenantUsers(tenantId);
  }

  /**
   * Get user's tenants
   * @param {string} userId - User ID
   * @returns {Promise<Array>} User's tenants
   */
  async getUserTenants(userId) {
    const tenantUsers = await this._loadUserTenants(userId);
    const tenants = [];

    for (const tenantUser of tenantUsers) {
      const tenant = await this.getTenant(tenantUser.tenantId);
      if (tenant) {
        tenants.push({
          ...tenant,
          roles: tenantUser.roles,
          joinedAt: tenantUser.joinedAt
        });
      }
    }

    return tenants;
  }

  /**
   * Database operations (to be implemented with actual database)
   */
  async _saveTenant(tenant) {
    // Database save implementation
  }

  async _updateTenant(tenant) {
    // Database update implementation
  }

  async _loadTenant(tenantId) {
    // Database load implementation
    return null;
  }

  async _loadTenantBySlug(slug) {
    // Database load by slug implementation
    return null;
  }

  async _queryTenants(filters) {
    // Database query implementation
    return [];
  }

  async _saveTenantUser(tenantUser) {
    // Database save tenant user implementation
  }

  async _removeTenantUser(tenantId, userId) {
    // Database remove tenant user implementation
  }

  async _loadTenantUsers(tenantId) {
    // Database load tenant users implementation
    return [];
  }

  async _loadUserTenants(userId) {
    // Database load user tenants implementation
    return [];
  }

  async _provisionTenantResources(tenant) {
    // Provision tenant-specific resources
  }

  async _scheduleTenantArchival(tenant) {
    // Schedule tenant data archival
  }

  /**
   * Clear cache for a tenant
   * @param {string} tenantId - Tenant ID
   */
  clearCache(tenantId) {
    this.cache.delete(tenantId);
  }

  /**
   * Clear all cache
   */
  clearAllCache() {
    this.cache.clear();
  }
}

module.exports = TenantService;