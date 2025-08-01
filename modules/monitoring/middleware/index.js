/**
 * Monitoring Middleware
 * @module monitoring/middleware
 */

/**
 * HTTP metrics middleware
 * Records request metrics
 */
const httpMetrics = (metricsCollector) => {
  return (req, res, next) => {
    const timer = metricsCollector.startTimer('http_request_duration_seconds', {
      method: req.method,
      route: req.route?.path || req.path
    });

    // Capture response status
    const originalEnd = res.end;
    res.end = function(...args) {
      const duration = timer();
      
      // Record metrics
      metricsCollector.inc('http_requests_total', 1, {
        method: req.method,
        route: req.route?.path || req.path,
        status: res.statusCode
      });

      // Call original end
      originalEnd.apply(res, args);
    };

    next();
  };
};

/**
 * Request tracing middleware
 * Creates trace spans for requests
 */
const requestTracing = (tracingService) => {
  return (req, res, next) => {
    // Extract parent context from headers
    const parentContext = tracingService.extract('w3c', req.headers);
    
    // Start request span
    const span = tracingService.startSpan(`${req.method} ${req.path}`, {
      parent: parentContext,
      tags: {
        'http.method': req.method,
        'http.url': req.url,
        'http.target': req.path,
        'http.host': req.hostname,
        'http.scheme': req.protocol,
        'user_agent': req.headers['user-agent']
      }
    });

    // Attach span to request
    req.span = span;

    // Inject trace context into response headers
    const traceContext = {
      traceId: span.span.traceId,
      spanId: span.span.spanId,
      sampled: span.span.sampled
    };
    tracingService.inject(traceContext, 'w3c', res.headers);

    // Capture response
    const originalEnd = res.end;
    res.end = function(...args) {
      // Set final span attributes
      span.setAttribute('http.status_code', res.statusCode);
      span.setAttribute('http.response_content_length', res.get('content-length') || 0);
      
      // Set span status based on HTTP status
      if (res.statusCode >= 400) {
        span.setStatus('error', `HTTP ${res.statusCode}`);
      }

      // End span
      span.end();

      // Call original end
      originalEnd.apply(res, args);
    };

    // Handle errors
    res.on('error', (error) => {
      span.setStatus('error', error.message);
      span.addEvent('error', {
        'error.type': error.name,
        'error.message': error.message
      });
    });

    next();
  };
};

/**
 * Request logging middleware
 * Logs request details
 */
const requestLogging = (loggingService) => {
  return (req, res, next) => {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] || generateRequestId();
    
    // Attach request ID
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);

    // Create child logger with request context
    req.logger = loggingService.child({
      requestId,
      method: req.method,
      path: req.path,
      ip: req.ip || req.connection.remoteAddress
    });

    // Log request
    req.logger.info('Request received', {
      headers: sanitizeHeaders(req.headers),
      query: req.query,
      body: req.body ? sanitizeBody(req.body) : undefined
    });

    // Capture response
    const originalEnd = res.end;
    res.end = function(...args) {
      const duration = Date.now() - startTime;
      
      // Log response
      req.logger.info('Request completed', {
        status: res.statusCode,
        duration,
        size: res.get('content-length') || 0
      });

      // Call original end
      originalEnd.apply(res, args);
    };

    // Handle errors
    res.on('error', (error) => {
      req.logger.error('Request error', { error });
    });

    next();
  };
};

/**
 * Error monitoring middleware
 * Captures and reports errors
 */
const errorMonitoring = (loggingService, metricsCollector) => {
  return (err, req, res, next) => {
    // Log error
    const logger = req.logger || loggingService;
    logger.error('Unhandled error', {
      error: err,
      stack: err.stack,
      request: {
        method: req.method,
        path: req.path,
        headers: sanitizeHeaders(req.headers)
      }
    });

    // Record error metric
    metricsCollector.inc('http_errors_total', 1, {
      method: req.method,
      route: req.route?.path || req.path,
      error: err.name || 'UnknownError'
    });

    // Add error to span if exists
    if (req.span) {
      req.span.setStatus('error', err.message);
      req.span.addEvent('exception', {
        'exception.type': err.name,
        'exception.message': err.message,
        'exception.stacktrace': err.stack
      });
    }

    // Pass to next error handler
    next(err);
  };
};

/**
 * Performance monitoring middleware
 * Tracks performance metrics
 */
const performanceMonitoring = (metricsCollector) => {
  return (req, res, next) => {
    // Memory usage before request
    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();

    // Capture metrics after response
    const originalEnd = res.end;
    res.end = function(...args) {
      setImmediate(() => {
        // Memory usage after request
        const memAfter = process.memoryUsage();
        const cpuAfter = process.cpuUsage(cpuBefore);

        // Record memory metrics
        metricsCollector.set('process_memory_heap_used_bytes', memAfter.heapUsed);
        metricsCollector.set('process_memory_heap_total_bytes', memAfter.heapTotal);
        metricsCollector.set('process_memory_rss_bytes', memAfter.rss);
        
        // Record CPU metrics
        const cpuTotal = (cpuAfter.user + cpuAfter.system) / 1000000; // Convert to seconds
        metricsCollector.observe('request_cpu_seconds', cpuTotal, {
          method: req.method,
          route: req.route?.path || req.path
        });
      });

      // Call original end
      originalEnd.apply(res, args);
    };

    next();
  };
};

/**
 * Helper functions
 */

function generateRequestId() {
  return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function sanitizeHeaders(headers) {
  const sanitized = { ...headers };
  const sensitive = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
  
  for (const header of sensitive) {
    if (sanitized[header]) {
      sanitized[header] = '***REDACTED***';
    }
  }
  
  return sanitized;
}

function sanitizeBody(body) {
  if (typeof body !== 'object') return body;
  
  const sanitized = { ...body };
  const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'creditCard'];
  
  function maskSensitive(obj) {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveFields.some(field => lowerKey.includes(field))) {
          obj[key] = '***MASKED***';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          maskSensitive(obj[key]);
        }
      }
    }
  }
  
  maskSensitive(sanitized);
  return sanitized;
}

module.exports = {
  httpMetrics,
  requestTracing,
  requestLogging,
  errorMonitoring,
  performanceMonitoring
};