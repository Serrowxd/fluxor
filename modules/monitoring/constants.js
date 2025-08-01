/**
 * Constants for Monitoring module
 * @module monitoring/constants
 */

const METRIC_TYPES = {
  COUNTER: 'counter',
  GAUGE: 'gauge',
  HISTOGRAM: 'histogram',
  SUMMARY: 'summary'
};

const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  TRACE: 'trace'
};

const LOG_LEVEL_PRIORITY = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};

const SPAN_STATUS = {
  OK: 'ok',
  ERROR: 'error',
  CANCELLED: 'cancelled'
};

const ALERT_SEVERITY = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFO: 'info'
};

const ALERT_STATUS = {
  FIRING: 'firing',
  RESOLVED: 'resolved',
  PENDING: 'pending'
};

const HEALTH_STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy'
};

const DEFAULT_METRICS = {
  // HTTP metrics
  'http_requests_total': {
    type: METRIC_TYPES.COUNTER,
    description: 'Total number of HTTP requests',
    labels: ['method', 'route', 'status']
  },
  'http_request_duration_seconds': {
    type: METRIC_TYPES.HISTOGRAM,
    description: 'HTTP request duration in seconds',
    labels: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  },
  
  // System metrics
  'process_cpu_usage_percent': {
    type: METRIC_TYPES.GAUGE,
    description: 'Process CPU usage percentage'
  },
  'process_memory_usage_bytes': {
    type: METRIC_TYPES.GAUGE,
    description: 'Process memory usage in bytes'
  },
  
  // Business metrics
  'inventory_items_total': {
    type: METRIC_TYPES.GAUGE,
    description: 'Total number of inventory items',
    labels: ['warehouse', 'category']
  },
  'orders_processed_total': {
    type: METRIC_TYPES.COUNTER,
    description: 'Total number of orders processed',
    labels: ['status', 'channel']
  }
};

const TRACE_PROPAGATION_FORMATS = {
  W3C: 'w3c',
  JAEGER: 'jaeger',
  B3: 'b3',
  AWS: 'aws'
};

const EXPORT_FORMATS = {
  PROMETHEUS: 'prometheus',
  OPENTELEMETRY: 'opentelemetry',
  STATSD: 'statsd',
  CLOUDWATCH: 'cloudwatch'
};

const SAMPLING_STRATEGIES = {
  ALWAYS_ON: 'always_on',
  ALWAYS_OFF: 'always_off',
  PROBABILITY: 'probability',
  RATE_LIMITING: 'rate_limiting',
  ADAPTIVE: 'adaptive'
};

const PROFILING_TYPES = {
  CPU: 'cpu',
  MEMORY: 'memory',
  BLOCKING: 'blocking',
  MUTEX: 'mutex'
};

module.exports = {
  METRIC_TYPES,
  LOG_LEVELS,
  LOG_LEVEL_PRIORITY,
  SPAN_STATUS,
  ALERT_SEVERITY,
  ALERT_STATUS,
  HEALTH_STATUS,
  DEFAULT_METRICS,
  TRACE_PROPAGATION_FORMATS,
  EXPORT_FORMATS,
  SAMPLING_STRATEGIES,
  PROFILING_TYPES
};