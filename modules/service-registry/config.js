/**
 * Configuration for Service Registry module
 * @module service-registry/config
 */

const { DEFAULT_CONFIG } = require('./constants');

const config = {
  // Service Registry Configuration
  registry: {
    heartbeatInterval: process.env.REGISTRY_HEARTBEAT_INTERVAL || DEFAULT_CONFIG.HEARTBEAT_INTERVAL,
    deregisterAfter: process.env.REGISTRY_DEREGISTER_AFTER || DEFAULT_CONFIG.DEREGISTER_AFTER,
    enablePersistence: process.env.REGISTRY_ENABLE_PERSISTENCE === 'true',
    persistenceInterval: 60000 // 1 minute
  },

  // Health Check Configuration
  healthCheck: {
    interval: process.env.HEALTH_CHECK_INTERVAL || DEFAULT_CONFIG.HEALTH_CHECK_INTERVAL,
    timeout: process.env.HEALTH_CHECK_TIMEOUT || DEFAULT_CONFIG.HEALTH_CHECK_TIMEOUT,
    retries: 3,
    retryDelay: 1000
  },

  // Circuit Breaker Configuration
  circuitBreaker: {
    failureThreshold: process.env.CB_FAILURE_THRESHOLD || DEFAULT_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    successThreshold: process.env.CB_SUCCESS_THRESHOLD || DEFAULT_CONFIG.CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
    timeout: process.env.CB_TIMEOUT || DEFAULT_CONFIG.CIRCUIT_BREAKER_TIMEOUT,
    resetTimeout: process.env.CB_RESET_TIMEOUT || DEFAULT_CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT
  },

  // Load Balancer Configuration
  loadBalancer: {
    defaultStrategy: process.env.LB_DEFAULT_STRATEGY || 'round-robin',
    stickySession: process.env.LB_STICKY_SESSION === 'true',
    sessionTimeout: 3600000 // 1 hour
  },

  // Database Configuration (for persistence)
  database: {
    connectionString: process.env.REGISTRY_DB_CONNECTION_STRING,
    pool: {
      min: 2,
      max: 10,
      idleTimeoutMillis: 30000
    }
  }
};

module.exports = config;