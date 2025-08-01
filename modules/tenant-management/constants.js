/**
 * Constants for Tenant Management module
 * @module tenant-management/constants
 */

const TENANT_STATUS = {
  PROVISIONING: 'provisioning',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  TERMINATED: 'terminated',
  ARCHIVED: 'archived'
};

const TENANT_EVENTS = {
  CREATED: 'tenant.created',
  UPDATED: 'tenant.updated',
  ACTIVATED: 'tenant.activated',
  SUSPENDED: 'tenant.suspended',
  TERMINATED: 'tenant.terminated',
  LIMIT_EXCEEDED: 'tenant.limit_exceeded',
  QUOTA_WARNING: 'tenant.quota_warning',
  USER_ADDED: 'tenant.user_added',
  USER_REMOVED: 'tenant.user_removed'
};

const ISOLATION_STRATEGIES = {
  SCHEMA: 'schema',
  DATABASE: 'database',
  ROW_LEVEL: 'row_level',
  PARTITION: 'partition'
};

const RESOURCE_TYPES = {
  USERS: 'users',
  STORAGE: 'storage',
  API_CALLS: 'api_calls',
  PRODUCTS: 'products',
  ORDERS: 'orders',
  BANDWIDTH: 'bandwidth',
  COMPUTE: 'compute'
};

const MIGRATION_TYPES = {
  EXPORT: 'export',
  IMPORT: 'import',
  CLONE: 'clone',
  MERGE: 'merge',
  SPLIT: 'split'
};

const MIGRATION_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

const DEFAULT_LIMITS = {
  users: 10,
  storage: 1073741824, // 1GB
  apiCalls: 10000,
  products: 1000,
  orders: 1000
};

const DEFAULT_FEATURES = {
  multiChannel: false,
  advancedAnalytics: false,
  customReports: false,
  apiAccess: true,
  webhooks: false,
  customFields: false
};

const QUOTA_WARNING_THRESHOLDS = {
  users: 0.9,
  storage: 0.8,
  apiCalls: 0.9,
  products: 0.9,
  orders: 0.9
};

module.exports = {
  TENANT_STATUS,
  TENANT_EVENTS,
  ISOLATION_STRATEGIES,
  RESOURCE_TYPES,
  MIGRATION_TYPES,
  MIGRATION_STATUS,
  DEFAULT_LIMITS,
  DEFAULT_FEATURES,
  QUOTA_WARNING_THRESHOLDS
};