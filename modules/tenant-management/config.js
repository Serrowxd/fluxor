/**
 * Configuration for Tenant Management module
 * @module tenant-management/config
 */

const { ISOLATION_STRATEGIES, DEFAULT_LIMITS, DEFAULT_FEATURES } = require('./constants');

const config = {
  // Tenant Isolation Configuration
  isolation: {
    strategy: process.env.TENANT_ISOLATION_STRATEGY || ISOLATION_STRATEGIES.SCHEMA,
    connectionPooling: {
      min: 2,
      max: 10,
      idleTimeoutMillis: 30000
    }
  },

  // Default Tenant Configuration
  defaults: {
    limits: {
      ...DEFAULT_LIMITS,
      ...(process.env.TENANT_DEFAULT_LIMITS ? JSON.parse(process.env.TENANT_DEFAULT_LIMITS) : {})
    },
    features: {
      ...DEFAULT_FEATURES,
      ...(process.env.TENANT_DEFAULT_FEATURES ? JSON.parse(process.env.TENANT_DEFAULT_FEATURES) : {})
    },
    trial: {
      enabled: process.env.TENANT_TRIAL_ENABLED === 'true',
      duration: parseInt(process.env.TENANT_TRIAL_DURATION || '14'), // days
      limits: {
        users: 5,
        storage: 536870912, // 500MB
        apiCalls: 5000
      }
    }
  },

  // Resource Quota Configuration
  quota: {
    checkInterval: 300000, // 5 minutes
    enforcementMode: process.env.QUOTA_ENFORCEMENT_MODE || 'soft', // soft, hard
    gracePeriod: 86400000, // 24 hours
    warningThresholds: {
      users: 0.9,
      storage: 0.8,
      apiCalls: 0.9
    }
  },

  // Tenant Data Configuration
  data: {
    retentionDays: parseInt(process.env.TENANT_DATA_RETENTION_DAYS || '365'),
    archiveAfterDays: parseInt(process.env.TENANT_ARCHIVE_AFTER_DAYS || '30'),
    purgeAfterDays: parseInt(process.env.TENANT_PURGE_AFTER_DAYS || '90')
  },

  // Migration Configuration
  migration: {
    batchSize: 1000,
    timeout: 3600000, // 1 hour
    tempDirectory: process.env.TENANT_MIGRATION_TEMP_DIR || '/tmp/tenant-migrations'
  },

  // Database Configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'fluxor',
    user: process.env.DB_USER || 'fluxor',
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true'
  },

  // Authorization Integration
  authorization: {
    module: '@fluxor/authorization',
    defaultPolicies: {
      tenantAdmin: 'tenant:*',
      tenantUser: 'tenant:read'
    }
  }
};

module.exports = config;