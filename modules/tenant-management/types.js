/**
 * Type definitions for Tenant Management module
 * @module tenant-management/types
 */

/**
 * @typedef {Object} Tenant
 * @property {string} id - Unique tenant identifier
 * @property {string} name - Tenant name
 * @property {string} slug - URL-safe tenant identifier
 * @property {string} status - Tenant status (active, suspended, terminated)
 * @property {Object} settings - Tenant-specific settings
 * @property {Object} features - Enabled features
 * @property {Object} limits - Resource limits
 * @property {Date} createdAt - Creation timestamp
 * @property {Date} updatedAt - Last update timestamp
 * @property {Date} expiresAt - Expiration date (optional)
 */

/**
 * @typedef {Object} TenantSettings
 * @property {string} timezone - Default timezone
 * @property {string} locale - Default locale
 * @property {string} currency - Default currency
 * @property {Object} branding - Branding configuration
 * @property {Object} notifications - Notification preferences
 * @property {Object} integrations - Third-party integrations
 */

/**
 * @typedef {Object} ResourceLimits
 * @property {number} users - Maximum number of users
 * @property {number} storage - Storage limit in bytes
 * @property {number} apiCalls - API calls per month
 * @property {number} products - Maximum number of products
 * @property {number} orders - Maximum orders per month
 * @property {Object} custom - Custom resource limits
 */

/**
 * @typedef {Object} ResourceUsage
 * @property {number} users - Current user count
 * @property {number} storage - Current storage usage
 * @property {number} apiCalls - API calls this month
 * @property {number} products - Current product count
 * @property {number} orders - Orders this month
 * @property {Object} custom - Custom resource usage
 * @property {Date} measuredAt - Measurement timestamp
 */

/**
 * @typedef {Object} TenantUser
 * @property {string} userId - User ID
 * @property {string} tenantId - Tenant ID
 * @property {string[]} roles - User roles within tenant
 * @property {Object} permissions - User permissions
 * @property {Date} joinedAt - Join date
 * @property {string} status - User status in tenant
 */

/**
 * @typedef {Object} TenantIsolationContext
 * @property {string} tenantId - Current tenant ID
 * @property {string} userId - Current user ID
 * @property {Object} permissions - Current permissions
 * @property {Object} limits - Current limits
 * @property {string} dataPartition - Data partition identifier
 */

/**
 * @typedef {Object} TenantMigrationTask
 * @property {string} id - Migration task ID
 * @property {string} sourceTenantId - Source tenant ID
 * @property {string} targetTenantId - Target tenant ID
 * @property {string} type - Migration type (export, import, clone)
 * @property {string} status - Migration status
 * @property {Object} options - Migration options
 * @property {Date} startedAt - Start timestamp
 * @property {Date} completedAt - Completion timestamp
 * @property {Object} result - Migration result
 */

/**
 * @typedef {Object} TenantEvent
 * @property {string} type - Event type
 * @property {string} tenantId - Tenant ID
 * @property {Object} data - Event data
 * @property {Date} timestamp - Event timestamp
 * @property {string} userId - User who triggered the event
 */

module.exports = {
  // Re-export types for TypeScript compatibility
};