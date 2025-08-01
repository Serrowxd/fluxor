/**
 * Tracing Service - Distributed tracing with OpenTelemetry
 * @module monitoring/services/TracingService
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const { SPAN_STATUS, TRACE_PROPAGATION_FORMATS, SAMPLING_STRATEGIES } = require('../constants');

class TracingService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.serviceName = config.tracing?.serviceName || 'unknown-service';
    this.serviceVersion = config.tracing?.serviceVersion || '0.0.0';
    this.samplingStrategy = config.tracing?.samplingStrategy || SAMPLING_STRATEGIES.PROBABILITY;
    this.samplingRate = config.tracing?.samplingRate || 0.1;
    
    this.activeSpans = new Map();
    this.completedSpans = [];
    this.traceContextStorage = new Map();
    
    this._initializeExporter();
  }

  /**
   * Start a new trace
   * @param {string} operationName - Operation name
   * @param {Object} options - Trace options
   * @returns {Object} Root span
   */
  startTrace(operationName, options = {}) {
    const traceId = options.traceId || this._generateTraceId();
    const shouldSample = this._shouldSample(traceId, operationName);
    
    const span = this.startSpan(operationName, {
      ...options,
      traceId,
      sampled: shouldSample,
      root: true
    });
    
    return span;
  }

  /**
   * Start a new span
   * @param {string} operationName - Operation name
   * @param {Object} options - Span options
   * @returns {Object} Span instance
   */
  startSpan(operationName, options = {}) {
    const context = this.getCurrentContext();
    const parentSpan = options.parent || context?.span;
    
    const span = {
      traceId: options.traceId || parentSpan?.traceId || this._generateTraceId(),
      spanId: this._generateSpanId(),
      parentSpanId: parentSpan?.spanId,
      operationName,
      startTime: new Date(),
      tags: {
        'service.name': this.serviceName,
        'service.version': this.serviceVersion,
        ...options.tags
      },
      attributes: options.attributes || {},
      events: [],
      status: SPAN_STATUS.OK,
      sampled: options.sampled !== undefined ? options.sampled : parentSpan?.sampled
    };
    
    // Add to active spans
    this.activeSpans.set(span.spanId, span);
    
    // Set as current span in context
    if (!options.detached) {
      this.setCurrentSpan(span);
    }
    
    this.emit('span.started', { span });
    
    // Return span controller
    return this._createSpanController(span);
  }

  /**
   * Get current context
   * @returns {Object|null} Current context
   */
  getCurrentContext() {
    const asyncId = this._getAsyncId();
    return this.traceContextStorage.get(asyncId);
  }

  /**
   * Set current span
   * @param {Object} span - Span to set as current
   */
  setCurrentSpan(span) {
    const asyncId = this._getAsyncId();
    this.traceContextStorage.set(asyncId, { span });
  }

  /**
   * Clear current context
   */
  clearCurrentContext() {
    const asyncId = this._getAsyncId();
    this.traceContextStorage.delete(asyncId);
  }

  /**
   * Extract trace context from carrier
   * @param {string} format - Propagation format
   * @param {Object} carrier - Carrier object
   * @returns {Object|null} Extracted context
   */
  extract(format, carrier) {
    switch (format) {
      case TRACE_PROPAGATION_FORMATS.W3C:
        return this._extractW3C(carrier);
      
      case TRACE_PROPAGATION_FORMATS.JAEGER:
        return this._extractJaeger(carrier);
      
      case TRACE_PROPAGATION_FORMATS.B3:
        return this._extractB3(carrier);
      
      default:
        return null;
    }
  }

  /**
   * Inject trace context into carrier
   * @param {Object} context - Trace context
   * @param {string} format - Propagation format
   * @param {Object} carrier - Carrier object
   */
  inject(context, format, carrier) {
    switch (format) {
      case TRACE_PROPAGATION_FORMATS.W3C:
        this._injectW3C(context, carrier);
        break;
      
      case TRACE_PROPAGATION_FORMATS.JAEGER:
        this._injectJaeger(context, carrier);
        break;
      
      case TRACE_PROPAGATION_FORMATS.B3:
        this._injectB3(context, carrier);
        break;
    }
  }

  /**
   * Get active spans
   * @returns {Array} Active spans
   */
  getActiveSpans() {
    return Array.from(this.activeSpans.values());
  }

  /**
   * Get completed spans
   * @param {Object} filter - Filter criteria
   * @returns {Array} Completed spans
   */
  getCompletedSpans(filter = {}) {
    let spans = [...this.completedSpans];
    
    if (filter.traceId) {
      spans = spans.filter(s => s.traceId === filter.traceId);
    }
    
    if (filter.operationName) {
      spans = spans.filter(s => s.operationName === filter.operationName);
    }
    
    if (filter.minDuration) {
      spans = spans.filter(s => s.duration >= filter.minDuration);
    }
    
    return spans;
  }

  /**
   * Export spans
   * @returns {Promise<void>}
   */
  async exportSpans() {
    if (this.completedSpans.length === 0) {
      return;
    }
    
    const spans = [...this.completedSpans];
    this.completedSpans = [];
    
    try {
      await this._exportSpans(spans);
      this.emit('spans.exported', { count: spans.length });
    } catch (error) {
      this.emit('export.error', { error, spans });
      // Re-add spans for retry
      this.completedSpans.unshift(...spans);
    }
  }

  /**
   * Create span controller
   * @private
   */
  _createSpanController(span) {
    const controller = {
      span,
      
      setTag: (key, value) => {
        span.tags[key] = value;
        return controller;
      },
      
      setAttribute: (key, value) => {
        span.attributes[key] = value;
        return controller;
      },
      
      addEvent: (name, attributes = {}) => {
        span.events.push({
          name,
          attributes,
          timestamp: new Date()
        });
        return controller;
      },
      
      setStatus: (status, message) => {
        span.status = status;
        if (message) {
          span.statusMessage = message;
        }
        return controller;
      },
      
      end: (endTime) => {
        span.endTime = endTime || new Date();
        span.duration = span.endTime - span.startTime;
        
        // Remove from active spans
        this.activeSpans.delete(span.spanId);
        
        // Add to completed spans if sampled
        if (span.sampled) {
          this.completedSpans.push(span);
          
          // Export if batch is full
          if (this.completedSpans.length >= this.config.tracing?.batchSize) {
            this.exportSpans();
          }
        }
        
        this.emit('span.ended', { span });
        
        // Clear context if this was the current span
        const context = this.getCurrentContext();
        if (context?.span?.spanId === span.spanId) {
          this.clearCurrentContext();
        }
        
        return span;
      }
    };
    
    return controller;
  }

  /**
   * Should sample decision
   * @private
   */
  _shouldSample(traceId, operationName) {
    switch (this.samplingStrategy) {
      case SAMPLING_STRATEGIES.ALWAYS_ON:
        return true;
      
      case SAMPLING_STRATEGIES.ALWAYS_OFF:
        return false;
      
      case SAMPLING_STRATEGIES.PROBABILITY:
        // Use trace ID for consistent sampling
        const hash = this._hashString(traceId);
        return (hash % 100) < (this.samplingRate * 100);
      
      case SAMPLING_STRATEGIES.RATE_LIMITING:
        // Simple rate limiting
        const now = Date.now();
        if (!this.samplingWindow || now - this.samplingWindow.start > 1000) {
          this.samplingWindow = { start: now, count: 0 };
        }
        
        if (this.samplingWindow.count < this.samplingRate) {
          this.samplingWindow.count++;
          return true;
        }
        return false;
      
      default:
        return false;
    }
  }

  /**
   * W3C TraceContext extraction
   * @private
   */
  _extractW3C(carrier) {
    const traceparent = carrier['traceparent'];
    if (!traceparent) return null;
    
    const parts = traceparent.split('-');
    if (parts.length !== 4) return null;
    
    return {
      traceId: parts[1],
      parentSpanId: parts[2],
      sampled: (parseInt(parts[3], 16) & 0x01) === 1
    };
  }

  /**
   * W3C TraceContext injection
   * @private
   */
  _injectW3C(context, carrier) {
    const flags = context.sampled ? '01' : '00';
    carrier['traceparent'] = `00-${context.traceId}-${context.spanId}-${flags}`;
    
    if (context.traceState) {
      carrier['tracestate'] = context.traceState;
    }
  }

  /**
   * Jaeger format extraction
   * @private
   */
  _extractJaeger(carrier) {
    const uber = carrier['uber-trace-id'];
    if (!uber) return null;
    
    const parts = uber.split(':');
    if (parts.length !== 4) return null;
    
    return {
      traceId: parts[0],
      parentSpanId: parts[1],
      sampled: parts[3] === '1'
    };
  }

  /**
   * Jaeger format injection
   * @private
   */
  _injectJaeger(context, carrier) {
    const flags = context.sampled ? '1' : '0';
    carrier['uber-trace-id'] = `${context.traceId}:${context.spanId}:0:${flags}`;
  }

  /**
   * B3 format extraction
   * @private
   */
  _extractB3(carrier) {
    const traceId = carrier['x-b3-traceid'];
    const spanId = carrier['x-b3-spanid'];
    const sampled = carrier['x-b3-sampled'];
    
    if (!traceId) return null;
    
    return {
      traceId,
      parentSpanId: spanId,
      sampled: sampled === '1'
    };
  }

  /**
   * B3 format injection
   * @private
   */
  _injectB3(context, carrier) {
    carrier['x-b3-traceid'] = context.traceId;
    carrier['x-b3-spanid'] = context.spanId;
    carrier['x-b3-sampled'] = context.sampled ? '1' : '0';
  }

  /**
   * Initialize exporter
   * @private
   */
  _initializeExporter() {
    // Set up batch export timer
    const batchTimeout = this.config.tracing?.batchTimeout || 5000;
    this.exportTimer = setInterval(() => {
      this.exportSpans();
    }, batchTimeout);
  }

  /**
   * Export spans implementation
   * @private
   */
  async _exportSpans(spans) {
    // This would send to configured backend
    // For now, just log
    const exportData = {
      serviceName: this.serviceName,
      serviceVersion: this.serviceVersion,
      spans: spans.map(span => ({
        ...span,
        startTime: span.startTime.toISOString(),
        endTime: span.endTime?.toISOString()
      }))
    };
    
    // In real implementation, would send to backend
    this.emit('spans.export', exportData);
  }

  /**
   * Generate trace ID
   * @private
   */
  _generateTraceId() {
    return uuidv4().replace(/-/g, '');
  }

  /**
   * Generate span ID
   * @private
   */
  _generateSpanId() {
    return uuidv4().replace(/-/g, '').substring(0, 16);
  }

  /**
   * Hash string to number
   * @private
   */
  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Get async context ID
   * @private
   */
  _getAsyncId() {
    // In real implementation, would use async_hooks
    return 'default';
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.exportTimer) {
      clearInterval(this.exportTimer);
    }
    
    // Export remaining spans
    this.exportSpans();
    
    this.activeSpans.clear();
    this.completedSpans = [];
    this.traceContextStorage.clear();
    this.removeAllListeners();
  }
}

module.exports = TracingService;