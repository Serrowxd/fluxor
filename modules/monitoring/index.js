/**
 * Monitoring Module
 * Metrics, tracing, and logging infrastructure
 * @module monitoring
 */

const MetricsCollector = require('./services/MetricsCollector');
const TracingService = require('./services/TracingService');
const LoggingService = require('./services/LoggingService');
const HealthMonitor = require('./services/HealthMonitor');
const AlertingService = require('./services/AlertingService');

const monitoringConfig = require('./config');
const monitoringTypes = require('./types');
const monitoringConstants = require('./constants');
const monitoringMiddleware = require('./middleware');

/**
 * Monitoring Module API
 */
module.exports = {
  // Core Services
  MetricsCollector,
  TracingService,
  LoggingService,
  HealthMonitor,
  AlertingService,

  // Middleware
  middleware: monitoringMiddleware,

  // Configuration
  config: monitoringConfig,

  // Types
  types: monitoringTypes,

  // Constants
  constants: monitoringConstants,

  // Factory Methods
  createMetricsCollector: (config) => new MetricsCollector(config),
  createTracingService: (config) => new TracingService(config),
  createLoggingService: (config) => new LoggingService(config),
  createHealthMonitor: (config) => new HealthMonitor(config),
  createAlertingService: (config) => new AlertingService(config)
};