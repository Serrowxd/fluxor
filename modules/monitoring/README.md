# Monitoring Module

Comprehensive metrics, tracing, and logging infrastructure for the Fluxor modular architecture.

## Features

- **Metrics Collection**: Prometheus-style metrics with multiple types (counter, gauge, histogram, summary)
- **Distributed Tracing**: OpenTelemetry-compatible tracing with multiple propagation formats
- **Structured Logging**: JSON/text logging with correlation and filtering
- **Health Monitoring**: Configurable health checks with detailed status reporting
- **Alerting Service**: Rule-based alerting with multiple notification channels

## Usage

```javascript
const { 
  MetricsCollector,
  TracingService,
  LoggingService,
  HealthMonitor,
  AlertingService,
  middleware
} = require('@fluxor/monitoring');

// Initialize services
const metrics = new MetricsCollector({ 
  defaultLabels: { service: 'inventory' }
});
const tracing = new TracingService({ 
  serviceName: 'inventory-service',
  samplingRate: 0.1 
});
const logging = new LoggingService({ 
  level: 'info',
  correlationEnabled: true 
});
const health = new HealthMonitor();
const alerting = new AlertingService();

// Register custom metrics
metrics.registerMetric({
  name: 'inventory_updates_total',
  type: 'counter',
  description: 'Total inventory updates',
  labels: ['warehouse', 'operation']
});

// Record metrics
metrics.inc('inventory_updates_total', 1, {
  warehouse: 'main',
  operation: 'restock'
});

// Start a trace
const trace = tracing.startTrace('process-order');
trace.setTag('order.id', '12345');
trace.setAttribute('customer.tier', 'premium');

// Log with context
logging.info('Processing order', {
  orderId: '12345',
  items: 5,
  total: 299.99
});

// Register health check
health.registerCheck('database', async () => {
  const start = Date.now();
  // Check database connection
  const healthy = await checkDatabase();
  return {
    healthy,
    responseTime: Date.now() - start
  };
});

// Register alert rule
alerting.registerRule({
  name: 'High Error Rate',
  expr: 'rate(http_errors_total[5m]) > 0.05',
  duration: 300000, // 5 minutes
  severity: 'critical',
  annotations: {
    message: 'Error rate is {{.Value}} errors/sec'
  }
});

// Apply middleware in Express
app.use(middleware.httpMetrics(metrics));
app.use(middleware.requestTracing(tracing));
app.use(middleware.requestLogging(logging));
app.use(middleware.performanceMonitoring(metrics));
app.use(middleware.errorMonitoring(logging, metrics));
```

## API Reference

### MetricsCollector

- `registerMetric(definition)`: Register a new metric
- `inc(name, value, labels)`: Increment counter
- `set(name, value, labels)`: Set gauge value
- `observe(name, value, labels)`: Record histogram observation
- `startTimer(name, labels)`: Start timer for histogram
- `getPrometheusMetrics()`: Get metrics in Prometheus format
- `getMetricsJSON()`: Get metrics as JSON

### TracingService

- `startTrace(operationName, options)`: Start new trace
- `startSpan(operationName, options)`: Start new span
- `extract(format, carrier)`: Extract trace context
- `inject(context, format, carrier)`: Inject trace context
- `getCurrentContext()`: Get current trace context
- `exportSpans()`: Export completed spans

### LoggingService

- `error/warn/info/debug/trace(message, context)`: Log at level
- `child(context)`: Create child logger with context
- `setLevel(level)`: Set log level
- `addOutput(output)`: Add log output
- `formatEntry(entry)`: Format log entry

### HealthMonitor

- `registerCheck(name, checkFn, options)`: Register health check
- `runCheck(name)`: Run check manually
- `getHealth()`: Get overall health status
- `getDetailedHealth()`: Get detailed health info
- `startAllChecks()`: Start automatic checks
- `stopAllChecks()`: Stop automatic checks

### AlertingService

- `registerRule(rule)`: Register alert rule
- `evaluateRules()`: Evaluate all rules
- `getActiveAlerts(filter)`: Get active alerts
- `acknowledgeAlert(alertId, ack)`: Acknowledge alert
- `addNotifier(notifier)`: Add notification channel
- `testNotification(alert)`: Test alert notification

## Metrics Types

### Counter
Monotonically increasing value (e.g., request count)
```javascript
metrics.inc('requests_total', 1, { method: 'GET' });
```

### Gauge
Value that can go up or down (e.g., active connections)
```javascript
metrics.set('active_connections', 42);
```

### Histogram
Distribution of values (e.g., request duration)
```javascript
metrics.observe('request_duration_seconds', 0.125);
// or use timer
const timer = metrics.startTimer('request_duration_seconds');
// ... do work ...
timer(); // Records duration
```

### Summary
Similar to histogram with quantiles
```javascript
metrics.observe('response_size_bytes', 1024);
```

## Trace Propagation Formats

- **W3C**: W3C Trace Context standard
- **Jaeger**: Uber Trace ID format
- **B3**: Zipkin B3 headers
- **AWS**: AWS X-Ray format

## Health Check Types

- **System**: CPU, memory, uptime
- **Database**: Connection and query health
- **Redis**: Connection health
- **Disk**: Available disk space
- **Memory**: Process memory usage
- **Custom**: Any async function returning health status

## Alert Rule Definition

```javascript
{
  name: 'High CPU Usage',
  expr: 'avg(process_cpu_percent) > 80',
  duration: 300000, // 5 minutes
  severity: 'warning',
  labels: {
    team: 'platform',
    component: 'api'
  },
  annotations: {
    message: 'CPU usage is {{.Value}}%',
    runbook: 'https://wiki/runbooks/high-cpu'
  }
}
```

## Middleware

### httpMetrics
Records HTTP request metrics (count, duration, status).

### requestTracing
Creates trace spans for HTTP requests.

### requestLogging
Logs request/response details with correlation.

### performanceMonitoring
Tracks CPU and memory usage per request.

### errorMonitoring
Captures and reports unhandled errors.

## Configuration

```javascript
{
  metrics: {
    enabled: true,
    port: 9090,
    path: '/metrics',
    format: 'prometheus'
  },
  tracing: {
    enabled: true,
    samplingRate: 0.1,
    exporter: {
      type: 'jaeger',
      endpoint: 'http://localhost:14268/api/traces'
    }
  },
  logging: {
    level: 'info',
    format: 'json',
    outputs: [
      { type: 'console' },
      { type: 'file', path: './logs/app.log' }
    ]
  },
  health: {
    port: 8080,
    path: '/health'
  },
  alerting: {
    enabled: true,
    evaluationInterval: 60000
  }
}
```