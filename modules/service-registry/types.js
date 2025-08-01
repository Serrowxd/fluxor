/**
 * Type definitions for Service Registry module
 * @module service-registry/types
 */

/**
 * @typedef {Object} ServiceDefinition
 * @property {string} id - Unique service identifier
 * @property {string} name - Service name
 * @property {string} version - Service version
 * @property {string} host - Service host address
 * @property {number} port - Service port number
 * @property {string} protocol - Service protocol (http, https, grpc, etc.)
 * @property {Object} metadata - Additional service metadata
 * @property {string[]} tags - Service tags for grouping/filtering
 * @property {number} weight - Weight for load balancing
 * @property {Date} registeredAt - Registration timestamp
 * @property {Date} lastHeartbeat - Last heartbeat timestamp
 */

/**
 * @typedef {Object} HealthStatus
 * @property {string} serviceId - Service identifier
 * @property {boolean} healthy - Overall health status
 * @property {number} responseTime - Response time in milliseconds
 * @property {Object} checks - Individual health check results
 * @property {Date} checkedAt - Health check timestamp
 * @property {string} error - Error message if unhealthy
 */

/**
 * @typedef {Object} ServiceInstance
 * @property {ServiceDefinition} definition - Service definition
 * @property {HealthStatus} health - Current health status
 * @property {Object} metrics - Service metrics
 * @property {CircuitBreakerState} circuitBreaker - Circuit breaker state
 */

/**
 * @typedef {Object} LoadBalancingStrategy
 * @property {'round-robin' | 'least-connections' | 'weighted' | 'random' | 'ip-hash'} type
 * @property {Object} config - Strategy-specific configuration
 */

/**
 * @typedef {Object} CircuitBreakerConfig
 * @property {number} failureThreshold - Number of failures before opening
 * @property {number} successThreshold - Number of successes before closing
 * @property {number} timeout - Timeout in milliseconds
 * @property {number} resetTimeout - Time before attempting to close
 */

/**
 * @typedef {Object} CircuitBreakerState
 * @property {'closed' | 'open' | 'half-open'} state
 * @property {number} failures - Current failure count
 * @property {number} successes - Current success count
 * @property {Date} lastFailure - Last failure timestamp
 * @property {Date} nextAttempt - Next attempt timestamp when open
 */

/**
 * @typedef {Object} ServiceQuery
 * @property {string} name - Service name filter
 * @property {string} version - Version filter
 * @property {string[]} tags - Tag filters
 * @property {boolean} healthyOnly - Only return healthy services
 */

/**
 * @typedef {Object} RegistryEvent
 * @property {'service-registered' | 'service-deregistered' | 'service-healthy' | 'service-unhealthy' | 'circuit-breaker-open' | 'circuit-breaker-closed'} type
 * @property {string} serviceId
 * @property {Object} data - Event-specific data
 * @property {Date} timestamp
 */

module.exports = {
  // Re-export types for TypeScript compatibility
};