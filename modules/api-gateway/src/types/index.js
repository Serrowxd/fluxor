// API Gateway types and enums

const RouteType = {
  PROXY: 'proxy',
  STATIC: 'static',
  FUNCTION: 'function',
  MOCK: 'mock'
};

const LoadBalancingStrategy = {
  ROUND_ROBIN: 'round_robin',
  LEAST_CONNECTIONS: 'least_connections',
  WEIGHTED: 'weighted',
  RANDOM: 'random',
  IP_HASH: 'ip_hash'
};

const TransformationType = {
  REQUEST: 'request',
  RESPONSE: 'response',
  ERROR: 'error'
};

const AuthStrategy = {
  NONE: 'none',
  API_KEY: 'api_key',
  JWT: 'jwt',
  OAUTH: 'oauth',
  BASIC: 'basic',
  CUSTOM: 'custom'
};

const CircuitBreakerState = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open'
};

/**
 * @typedef {Object} Route
 * @property {string} id - Route identifier
 * @property {string} path - Route path pattern
 * @property {string[]} methods - HTTP methods
 * @property {string} type - Route type
 * @property {string} version - API version
 * @property {string} [description] - Route description
 * @property {Object} target - Route target configuration
 * @property {Object} [auth] - Authentication configuration
 * @property {Object} [rateLimit] - Rate limiting configuration
 * @property {Object} [transformations] - Transformation rules
 * @property {Object} [validation] - Request validation
 * @property {Object} [cache] - Caching configuration
 * @property {Object} [cors] - CORS configuration
 * @property {boolean} [enabled] - Whether route is enabled
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} ServiceTarget
 * @property {string} service - Service name
 * @property {string[]} [urls] - Service URLs
 * @property {string} [path] - Target path
 * @property {string} loadBalancing - Load balancing strategy
 * @property {Object} [healthCheck] - Health check configuration
 * @property {Object} [circuitBreaker] - Circuit breaker configuration
 * @property {number} [timeout] - Request timeout
 * @property {Object} [retry] - Retry configuration
 */

/**
 * @typedef {Object} Transformation
 * @property {string} type - Transformation type
 * @property {string} [condition] - Condition for applying transformation
 * @property {Object[]} rules - Transformation rules
 */

/**
 * @typedef {Object} TransformationRule
 * @property {string} action - Transformation action
 * @property {string} [source] - Source path
 * @property {string} [target] - Target path
 * @property {*} [value] - Static value
 * @property {string} [template] - Template string
 * @property {Object} [options] - Action-specific options
 */

/**
 * @typedef {Object} RateLimitConfig
 * @property {number} points - Number of points
 * @property {number} duration - Duration in seconds
 * @property {string} [keyGenerator] - Custom key generator
 * @property {boolean} [blockDuration] - Block duration in seconds
 * @property {Object} [headers] - Rate limit headers configuration
 */

/**
 * @typedef {Object} ValidationConfig
 * @property {Object} [headers] - Header validation schema
 * @property {Object} [query] - Query validation schema
 * @property {Object} [params] - Params validation schema
 * @property {Object} [body] - Body validation schema
 * @property {boolean} [stripUnknown] - Strip unknown fields
 * @property {boolean} [abortEarly] - Abort on first error
 */

/**
 * @typedef {Object} CacheConfig
 * @property {boolean} enabled - Whether caching is enabled
 * @property {number} ttl - Cache TTL in seconds
 * @property {string[]} [varyBy] - Headers to vary cache by
 * @property {string[]} [methods] - Methods to cache
 * @property {number[]} [statusCodes] - Status codes to cache
 * @property {boolean} [private] - Private cache
 */

/**
 * @typedef {Object} CircuitBreakerConfig
 * @property {number} threshold - Failure threshold
 * @property {number} timeout - Timeout in milliseconds
 * @property {number} resetTimeout - Reset timeout in milliseconds
 * @property {Function} [isFailure] - Custom failure detector
 * @property {Function} [fallback] - Fallback function
 */

/**
 * @typedef {Object} APIVersion
 * @property {string} version - Version identifier
 * @property {Date} [deprecatedAt] - Deprecation date
 * @property {Date} [sunsetAt] - Sunset date
 * @property {string} [migrationGuide] - Migration guide URL
 */

/**
 * @typedef {Object} GatewayMetrics
 * @property {number} totalRequests - Total requests
 * @property {number} successfulRequests - Successful requests
 * @property {number} failedRequests - Failed requests
 * @property {Object} statusCodes - Status code distribution
 * @property {Object} responseTime - Response time stats
 * @property {Object} routes - Per-route metrics
 * @property {Object} services - Per-service metrics
 */

module.exports = {
  RouteType,
  LoadBalancingStrategy,
  TransformationType,
  AuthStrategy,
  CircuitBreakerState
};