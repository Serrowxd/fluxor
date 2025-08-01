/**
 * Service Registry Module
 * Provides service discovery and health monitoring capabilities
 * @module service-registry
 */

const ServiceRegistry = require('./services/ServiceRegistry');
const HealthChecker = require('./services/HealthChecker');
const LoadBalancer = require('./services/LoadBalancer');
const CircuitBreaker = require('./services/CircuitBreaker');
const ServiceDiscovery = require('./services/ServiceDiscovery');

const serviceRegistryConfig = require('./config');
const serviceRegistryTypes = require('./types');
const serviceRegistryConstants = require('./constants');

/**
 * Service Registry Module API
 */
module.exports = {
  // Core Services
  ServiceRegistry,
  HealthChecker,
  LoadBalancer,
  CircuitBreaker,
  ServiceDiscovery,

  // Configuration
  config: serviceRegistryConfig,

  // Types
  types: serviceRegistryTypes,

  // Constants
  constants: serviceRegistryConstants,

  // Factory Methods
  createServiceRegistry: (config) => new ServiceRegistry(config),
  createHealthChecker: (config) => new HealthChecker(config),
  createLoadBalancer: (strategy) => new LoadBalancer(strategy),
  createCircuitBreaker: (config) => new CircuitBreaker(config)
};