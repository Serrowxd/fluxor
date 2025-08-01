/**
 * Tenant Management Module
 * Multi-tenant isolation and management
 * @module tenant-management
 */

const TenantService = require('./services/TenantService');
const TenantIsolation = require('./services/TenantIsolation');
const ResourceQuota = require('./services/ResourceQuota');
const TenantConfiguration = require('./services/TenantConfiguration');
const TenantMigration = require('./services/TenantMigration');

const tenantConfig = require('./config');
const tenantTypes = require('./types');
const tenantConstants = require('./constants');
const tenantMiddleware = require('./middleware');

/**
 * Tenant Management Module API
 */
module.exports = {
  // Core Services
  TenantService,
  TenantIsolation,
  ResourceQuota,
  TenantConfiguration,
  TenantMigration,

  // Middleware
  middleware: tenantMiddleware,

  // Configuration
  config: tenantConfig,

  // Types
  types: tenantTypes,

  // Constants
  constants: tenantConstants,

  // Factory Methods
  createTenantService: (config) => new TenantService(config),
  createTenantIsolation: (config) => new TenantIsolation(config),
  createResourceQuota: (config) => new ResourceQuota(config),
  createTenantConfiguration: (config) => new TenantConfiguration(config),
  createTenantMigration: (config) => new TenantMigration(config)
};