// Configuration types and enums

const ConfigurationType = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  JSON: 'json',
  ARRAY: 'array',
  OBJECT: 'object'
};

const ConfigurationScope = {
  GLOBAL: 'global',
  TENANT: 'tenant',
  USER: 'user',
  SERVICE: 'service'
};

const ConfigurationSource = {
  DEFAULT: 'default',
  FILE: 'file',
  ENVIRONMENT: 'environment',
  DATABASE: 'database',
  REMOTE: 'remote'
};

const FeatureFlagStatus = {
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  PARTIAL: 'partial'
};

const FeatureFlagStrategy = {
  BOOLEAN: 'boolean',
  PERCENTAGE: 'percentage',
  USER_LIST: 'user_list',
  GROUP: 'group',
  GRADUAL: 'gradual',
  CUSTOM: 'custom'
};

/**
 * @typedef {Object} ConfigurationItem
 * @property {string} key - Configuration key (dot notation supported)
 * @property {*} value - Configuration value
 * @property {string} type - Value type from ConfigurationType
 * @property {string} scope - Configuration scope
 * @property {string} source - Where the config came from
 * @property {string} [description] - Human-readable description
 * @property {*} [defaultValue] - Default value if not set
 * @property {Object} [validation] - Joi validation schema
 * @property {boolean} [sensitive] - Whether value is sensitive
 * @property {boolean} [encrypted] - Whether value is encrypted
 * @property {Date} [expiresAt] - When config expires
 * @property {Object} [metadata] - Additional metadata
 * @property {Date} createdAt
 * @property {Date} updatedAt
 * @property {number} version - Version number for updates
 */

/**
 * @typedef {Object} FeatureFlag
 * @property {string} key - Feature flag key
 * @property {string} name - Human-readable name
 * @property {string} description - Feature description
 * @property {string} status - Flag status
 * @property {string} strategy - Rollout strategy
 * @property {Object} rules - Strategy-specific rules
 * @property {Array<string>} [tags] - Feature tags
 * @property {Object} [metadata] - Additional metadata
 * @property {Date} [enabledAt] - When feature was enabled
 * @property {Date} [disabledAt] - When feature was disabled
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} ConfigurationChange
 * @property {string} key - Configuration key
 * @property {*} oldValue - Previous value
 * @property {*} newValue - New value
 * @property {string} source - Change source
 * @property {string} [userId] - User who made the change
 * @property {string} [reason] - Change reason
 * @property {Date} timestamp - When change occurred
 */

/**
 * @typedef {Object} FeatureFlagEvaluation
 * @property {string} key - Feature flag key
 * @property {boolean} enabled - Whether feature is enabled
 * @property {string} strategy - Strategy used
 * @property {string} [variant] - Feature variant if applicable
 * @property {Object} [metadata] - Evaluation metadata
 * @property {string} [reason] - Why this decision was made
 */

/**
 * @typedef {Object} ConfigurationQuery
 * @property {string} [prefix] - Key prefix to filter by
 * @property {string} [scope] - Scope to filter by
 * @property {string} [source] - Source to filter by
 * @property {Array<string>} [keys] - Specific keys to retrieve
 * @property {boolean} [includeDefaults] - Include default values
 * @property {boolean} [includeSensitive] - Include sensitive values
 * @property {Object} [context] - Context for evaluation
 */

module.exports = {
  ConfigurationType,
  ConfigurationScope,
  ConfigurationSource,
  FeatureFlagStatus,
  FeatureFlagStrategy
};