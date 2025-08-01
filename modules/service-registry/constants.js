/**
 * Constants for Service Registry module
 * @module service-registry/constants
 */

const SERVICE_STATES = {
  STARTING: 'starting',
  HEALTHY: 'healthy',
  UNHEALTHY: 'unhealthy',
  STOPPING: 'stopping',
  STOPPED: 'stopped'
};

const CIRCUIT_BREAKER_STATES = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half-open'
};

const LOAD_BALANCING_STRATEGIES = {
  ROUND_ROBIN: 'round-robin',
  LEAST_CONNECTIONS: 'least-connections',
  WEIGHTED: 'weighted',
  RANDOM: 'random',
  IP_HASH: 'ip-hash'
};

const HEALTH_CHECK_TYPES = {
  HTTP: 'http',
  TCP: 'tcp',
  EXEC: 'exec',
  TTL: 'ttl'
};

const DEFAULT_CONFIG = {
  HEARTBEAT_INTERVAL: 30000, // 30 seconds
  HEALTH_CHECK_INTERVAL: 10000, // 10 seconds
  HEALTH_CHECK_TIMEOUT: 5000, // 5 seconds
  DEREGISTER_AFTER: 300000, // 5 minutes
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: 5,
  CIRCUIT_BREAKER_SUCCESS_THRESHOLD: 2,
  CIRCUIT_BREAKER_TIMEOUT: 60000, // 1 minute
  CIRCUIT_BREAKER_RESET_TIMEOUT: 30000 // 30 seconds
};

const EVENTS = {
  SERVICE_REGISTERED: 'service-registered',
  SERVICE_DEREGISTERED: 'service-deregistered',
  SERVICE_HEALTHY: 'service-healthy',
  SERVICE_UNHEALTHY: 'service-unhealthy',
  CIRCUIT_BREAKER_OPEN: 'circuit-breaker-open',
  CIRCUIT_BREAKER_CLOSED: 'circuit-breaker-closed',
  CIRCUIT_BREAKER_HALF_OPEN: 'circuit-breaker-half-open'
};

module.exports = {
  SERVICE_STATES,
  CIRCUIT_BREAKER_STATES,
  LOAD_BALANCING_STRATEGIES,
  HEALTH_CHECK_TYPES,
  DEFAULT_CONFIG,
  EVENTS
};