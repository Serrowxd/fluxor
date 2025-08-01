/**
 * Configuration for Monitoring module
 * @module monitoring/config
 */

const { LOG_LEVELS, EXPORT_FORMATS, SAMPLING_STRATEGIES } = require('./constants');

const config = {
  // Metrics Configuration
  metrics: {
    enabled: process.env.METRICS_ENABLED !== 'false',
    port: parseInt(process.env.METRICS_PORT || '9090'),
    path: process.env.METRICS_PATH || '/metrics',
    format: process.env.METRICS_FORMAT || EXPORT_FORMATS.PROMETHEUS,
    defaultLabels: {
      service: process.env.SERVICE_NAME || 'fluxor',
      environment: process.env.NODE_ENV || 'development',
      version: process.env.SERVICE_VERSION || '1.0.0'
    },
    aggregationInterval: 60000, // 1 minute
    retentionPeriod: 86400000 * 7 // 7 days
  },

  // Tracing Configuration
  tracing: {
    enabled: process.env.TRACING_ENABLED === 'true',
    serviceName: process.env.SERVICE_NAME || 'fluxor',
    serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
    samplingStrategy: process.env.SAMPLING_STRATEGY || SAMPLING_STRATEGIES.PROBABILITY,
    samplingRate: parseFloat(process.env.SAMPLING_RATE || '0.1'),
    propagationFormat: process.env.TRACE_PROPAGATION || 'w3c',
    exporter: {
      type: process.env.TRACE_EXPORTER || 'jaeger',
      endpoint: process.env.TRACE_ENDPOINT || 'http://localhost:14268/api/traces',
      headers: process.env.TRACE_HEADERS ? JSON.parse(process.env.TRACE_HEADERS) : {}
    },
    batchSize: 100,
    batchTimeout: 5000 // 5 seconds
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || LOG_LEVELS.INFO,
    format: process.env.LOG_FORMAT || 'json',
    correlationEnabled: process.env.LOG_CORRELATION !== 'false',
    outputs: [
      {
        type: 'console',
        format: process.env.NODE_ENV === 'production' ? 'json' : 'pretty'
      },
      {
        type: 'file',
        path: process.env.LOG_FILE_PATH || './logs/app.log',
        maxSize: '100m',
        maxFiles: 5,
        compress: true
      }
    ],
    filters: {
      excludePaths: ['/health', '/metrics'],
      excludeHeaders: ['authorization', 'cookie'],
      maskFields: ['password', 'token', 'secret', 'key']
    }
  },

  // Health Monitoring Configuration
  health: {
    enabled: process.env.HEALTH_ENABLED !== 'false',
    port: parseInt(process.env.HEALTH_PORT || '8080'),
    path: process.env.HEALTH_PATH || '/health',
    detailedPath: process.env.HEALTH_DETAILED_PATH || '/health/detailed',
    checks: {
      database: {
        enabled: true,
        interval: 30000, // 30 seconds
        timeout: 5000
      },
      redis: {
        enabled: true,
        interval: 30000,
        timeout: 3000
      },
      disk: {
        enabled: true,
        interval: 60000, // 1 minute
        threshold: 0.9 // 90% usage warning
      },
      memory: {
        enabled: true,
        interval: 30000,
        threshold: 0.85 // 85% usage warning
      }
    }
  },

  // Alerting Configuration
  alerting: {
    enabled: process.env.ALERTING_ENABLED === 'true',
    evaluationInterval: 60000, // 1 minute
    rules: {
      path: process.env.ALERT_RULES_PATH || './config/alert-rules.yml',
      reload: true,
      reloadInterval: 300000 // 5 minutes
    },
    notifiers: [
      {
        type: 'webhook',
        enabled: process.env.WEBHOOK_ALERTS === 'true',
        url: process.env.ALERT_WEBHOOK_URL,
        headers: process.env.ALERT_WEBHOOK_HEADERS ? JSON.parse(process.env.ALERT_WEBHOOK_HEADERS) : {}
      },
      {
        type: 'email',
        enabled: process.env.EMAIL_ALERTS === 'true',
        smtp: {
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        },
        from: process.env.ALERT_EMAIL_FROM,
        to: process.env.ALERT_EMAIL_TO?.split(',') || []
      }
    ]
  },

  // Performance Profiling Configuration
  profiling: {
    enabled: process.env.PROFILING_ENABLED === 'true',
    cpu: {
      enabled: true,
      interval: 1000,
      duration: 10000
    },
    memory: {
      enabled: true,
      interval: 5000,
      heapSnapshot: false
    }
  }
};

module.exports = config;