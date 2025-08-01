/**
 * Type definitions for Monitoring module
 * @module monitoring/types
 */

/**
 * @typedef {Object} Metric
 * @property {string} name - Metric name
 * @property {string} type - Metric type (counter, gauge, histogram, summary)
 * @property {number} value - Metric value
 * @property {Object} labels - Metric labels
 * @property {Date} timestamp - Metric timestamp
 * @property {string} unit - Metric unit (optional)
 * @property {string} description - Metric description
 */

/**
 * @typedef {Object} Trace
 * @property {string} traceId - Trace identifier
 * @property {string} spanId - Span identifier
 * @property {string} parentSpanId - Parent span ID (optional)
 * @property {string} operationName - Operation name
 * @property {Date} startTime - Start timestamp
 * @property {Date} endTime - End timestamp (optional)
 * @property {number} duration - Duration in milliseconds
 * @property {Object} tags - Span tags
 * @property {Object} attributes - Span attributes
 * @property {string} status - Span status (ok, error, cancelled)
 * @property {Array<Event>} events - Span events
 */

/**
 * @typedef {Object} LogEntry
 * @property {string} level - Log level (error, warn, info, debug, trace)
 * @property {string} message - Log message
 * @property {Date} timestamp - Log timestamp
 * @property {Object} context - Contextual data
 * @property {string} traceId - Associated trace ID (optional)
 * @property {string} spanId - Associated span ID (optional)
 * @property {Error} error - Error object (optional)
 * @property {Object} metadata - Additional metadata
 */

/**
 * @typedef {Object} HealthCheck
 * @property {string} name - Check name
 * @property {string} component - Component being checked
 * @property {boolean} healthy - Health status
 * @property {string} status - Status description
 * @property {number} responseTime - Check response time
 * @property {Object} details - Check details
 * @property {Date} checkedAt - Check timestamp
 */

/**
 * @typedef {Object} Alert
 * @property {string} id - Alert identifier
 * @property {string} name - Alert name
 * @property {string} severity - Alert severity (critical, warning, info)
 * @property {string} status - Alert status (firing, resolved, pending)
 * @property {string} message - Alert message
 * @property {Object} labels - Alert labels
 * @property {Object} annotations - Alert annotations
 * @property {Date} startsAt - Alert start time
 * @property {Date} endsAt - Alert end time (optional)
 * @property {string} source - Alert source
 */

/**
 * @typedef {Object} MetricDefinition
 * @property {string} name - Metric name
 * @property {string} type - Metric type
 * @property {string} description - Metric description
 * @property {string} unit - Metric unit
 * @property {Array<string>} labels - Label names
 * @property {Object} buckets - Histogram buckets (for histogram type)
 * @property {Object} quantiles - Summary quantiles (for summary type)
 */

/**
 * @typedef {Object} TracingConfig
 * @property {string} serviceName - Service name
 * @property {string} serviceVersion - Service version
 * @property {number} samplingRate - Sampling rate (0-1)
 * @property {Object} propagators - Propagation formats
 * @property {Object} exporters - Trace exporters
 */

/**
 * @typedef {Object} LoggingConfig
 * @property {string} level - Default log level
 * @property {string} format - Log format (json, text)
 * @property {Array<Object>} outputs - Log outputs
 * @property {boolean} correlationEnabled - Enable trace correlation
 * @property {Object} filters - Log filters
 */

/**
 * @typedef {Object} AlertRule
 * @property {string} name - Rule name
 * @property {string} expr - Rule expression
 * @property {string} duration - Duration before firing
 * @property {Object} labels - Alert labels
 * @property {Object} annotations - Alert annotations
 * @property {string} severity - Alert severity
 */

/**
 * @typedef {Object} Dashboard
 * @property {string} id - Dashboard ID
 * @property {string} name - Dashboard name
 * @property {Array<Panel>} panels - Dashboard panels
 * @property {Object} variables - Dashboard variables
 * @property {Object} timeRange - Time range settings
 */

/**
 * @typedef {Object} Panel
 * @property {string} id - Panel ID
 * @property {string} title - Panel title
 * @property {string} type - Panel type (graph, stat, table, etc.)
 * @property {Array<Query>} queries - Panel queries
 * @property {Object} options - Panel options
 */

module.exports = {
  // Re-export types for TypeScript compatibility
};