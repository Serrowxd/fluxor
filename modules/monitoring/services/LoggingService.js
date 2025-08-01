/**
 * Logging Service - Structured logging with correlation
 * @module monitoring/services/LoggingService
 */

const EventEmitter = require('events');
const { LOG_LEVELS, LOG_LEVEL_PRIORITY } = require('../constants');

class LoggingService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.level = config.logging?.level || LOG_LEVELS.INFO;
    this.format = config.logging?.format || 'json';
    this.correlationEnabled = config.logging?.correlationEnabled !== false;
    this.filters = config.logging?.filters || {};
    this.outputs = [];
    
    this._initializeOutputs();
  }

  /**
   * Log an error message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  error(message, context = {}) {
    this._log(LOG_LEVELS.ERROR, message, context);
  }

  /**
   * Log a warning message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  warn(message, context = {}) {
    this._log(LOG_LEVELS.WARN, message, context);
  }

  /**
   * Log an info message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  info(message, context = {}) {
    this._log(LOG_LEVELS.INFO, message, context);
  }

  /**
   * Log a debug message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  debug(message, context = {}) {
    this._log(LOG_LEVELS.DEBUG, message, context);
  }

  /**
   * Log a trace message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  trace(message, context = {}) {
    this._log(LOG_LEVELS.TRACE, message, context);
  }

  /**
   * Create a child logger with additional context
   * @param {Object} context - Additional context
   * @returns {Object} Child logger
   */
  child(context = {}) {
    const childLogger = {
      context,
      error: (message, ctx = {}) => this.error(message, { ...context, ...ctx }),
      warn: (message, ctx = {}) => this.warn(message, { ...context, ...ctx }),
      info: (message, ctx = {}) => this.info(message, { ...context, ...ctx }),
      debug: (message, ctx = {}) => this.debug(message, { ...context, ...ctx }),
      trace: (message, ctx = {}) => this.trace(message, { ...context, ...ctx })
    };
    
    return childLogger;
  }

  /**
   * Set log level
   * @param {string} level - New log level
   */
  setLevel(level) {
    if (!LOG_LEVEL_PRIORITY.hasOwnProperty(level)) {
      throw new Error(`Invalid log level: ${level}`);
    }
    
    this.level = level;
    this.emit('level.changed', { level });
  }

  /**
   * Add output handler
   * @param {Object} output - Output handler
   */
  addOutput(output) {
    this.outputs.push(output);
  }

  /**
   * Remove output handler
   * @param {Object} output - Output handler
   */
  removeOutput(output) {
    const index = this.outputs.indexOf(output);
    if (index !== -1) {
      this.outputs.splice(index, 1);
    }
  }

  /**
   * Format log entry
   * @param {Object} entry - Log entry
   * @returns {string} Formatted log
   */
  formatEntry(entry) {
    if (this.format === 'json') {
      return JSON.stringify(entry);
    } else if (this.format === 'pretty') {
      const { timestamp, level, message, ...rest } = entry;
      const time = new Date(timestamp).toISOString();
      const contextStr = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
      return `[${time}] ${level.toUpperCase()}: ${message}${contextStr}`;
    } else {
      // Simple text format
      return `${entry.level}: ${entry.message}`;
    }
  }

  /**
   * Main logging method
   * @private
   */
  _log(level, message, context = {}) {
    // Check if should log based on level
    if (!this._shouldLog(level)) {
      return;
    }
    
    // Create log entry
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this._sanitizeContext(context)
    };
    
    // Add correlation IDs if enabled
    if (this.correlationEnabled) {
      const correlation = this._getCorrelationIds();
      if (correlation.traceId) entry.traceId = correlation.traceId;
      if (correlation.spanId) entry.spanId = correlation.spanId;
      if (correlation.requestId) entry.requestId = correlation.requestId;
    }
    
    // Add error details if present
    if (context.error) {
      entry.error = this._formatError(context.error);
    }
    
    // Apply filters
    if (this._shouldFilter(entry)) {
      return;
    }
    
    // Send to outputs
    for (const output of this.outputs) {
      try {
        output.write(entry);
      } catch (error) {
        // Don't throw, but emit error
        this.emit('output.error', { output, error });
      }
    }
    
    // Emit log event
    this.emit('log', entry);
  }

  /**
   * Check if should log based on level
   * @private
   */
  _shouldLog(level) {
    return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[this.level];
  }

  /**
   * Check if should filter entry
   * @private
   */
  _shouldFilter(entry) {
    // Path filtering
    if (this.filters.excludePaths && entry.path) {
      for (const path of this.filters.excludePaths) {
        if (entry.path.includes(path)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Sanitize context data
   * @private
   */
  _sanitizeContext(context) {
    const sanitized = { ...context };
    
    // Remove sensitive headers
    if (sanitized.headers && this.filters.excludeHeaders) {
      for (const header of this.filters.excludeHeaders) {
        delete sanitized.headers[header];
        delete sanitized.headers[header.toLowerCase()];
      }
    }
    
    // Mask sensitive fields
    if (this.filters.maskFields) {
      this._maskFields(sanitized, this.filters.maskFields);
    }
    
    return sanitized;
  }

  /**
   * Mask sensitive fields
   * @private
   */
  _maskFields(obj, fields, depth = 0) {
    if (depth > 10) return; // Prevent infinite recursion
    
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const lowerKey = key.toLowerCase();
        
        // Check if field should be masked
        const shouldMask = fields.some(field => 
          lowerKey.includes(field.toLowerCase())
        );
        
        if (shouldMask) {
          obj[key] = '***MASKED***';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          this._maskFields(obj[key], fields, depth + 1);
        }
      }
    }
  }

  /**
   * Format error object
   * @private
   */
  _formatError(error) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack?.split('\n').map(line => line.trim()),
        ...error
      };
    }
    return error;
  }

  /**
   * Get correlation IDs from context
   * @private
   */
  _getCorrelationIds() {
    // This would integrate with TracingService
    // For now, return empty
    return {};
  }

  /**
   * Initialize output handlers
   * @private
   */
  _initializeOutputs() {
    const outputs = this.config.logging?.outputs || [];
    
    for (const outputConfig of outputs) {
      const output = this._createOutput(outputConfig);
      if (output) {
        this.outputs.push(output);
      }
    }
  }

  /**
   * Create output handler
   * @private
   */
  _createOutput(config) {
    switch (config.type) {
      case 'console':
        return new ConsoleOutput(config);
      
      case 'file':
        return new FileOutput(config);
      
      default:
        return null;
    }
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    for (const output of this.outputs) {
      if (output.cleanup) {
        output.cleanup();
      }
    }
    
    this.outputs = [];
    this.removeAllListeners();
  }
}

/**
 * Console output handler
 */
class ConsoleOutput {
  constructor(config = {}) {
    this.config = config;
    this.format = config.format || 'json';
  }

  write(entry) {
    const formatted = this.format === 'pretty' 
      ? this._prettyFormat(entry)
      : JSON.stringify(entry);
    
    switch (entry.level) {
      case LOG_LEVELS.ERROR:
        console.error(formatted);
        break;
      case LOG_LEVELS.WARN:
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  _prettyFormat(entry) {
    const { timestamp, level, message, error, ...rest } = entry;
    const time = new Date(timestamp).toLocaleTimeString();
    const levelStr = level.toUpperCase().padEnd(5);
    const contextStr = Object.keys(rest).length > 0 
      ? '\n  ' + JSON.stringify(rest, null, 2).replace(/\n/g, '\n  ')
      : '';
    
    let output = `[${time}] ${levelStr} ${message}${contextStr}`;
    
    if (error) {
      output += '\n  Error: ' + (error.stack || error.message || JSON.stringify(error));
    }
    
    return output;
  }
}

/**
 * File output handler
 */
class FileOutput {
  constructor(config = {}) {
    this.config = config;
    this.path = config.path;
    // In real implementation, would set up file writing
  }

  write(entry) {
    // In real implementation, would write to file
    const line = JSON.stringify(entry) + '\n';
    // fs.appendFileSync(this.path, line);
  }

  cleanup() {
    // Close file handles
  }
}

module.exports = LoggingService;