const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6
};

// Define log colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  verbose: 'cyan',
  debug: 'blue',
  silly: 'grey'
};

winston.addColors(colors);

// Create the log directory if it doesn't exist
const logDir = process.env.LOG_DIR || 'logs';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: logFormat,
  transports: [
    // Console transport
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' ? logFormat : consoleFormat
    })
  ]
});

// Add file transports in production
if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }));

  logger.add(new winston.transports.File({
    filename: path.join(logDir, 'combined.log'),
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }));

  // Security audit log
  logger.add(new winston.transports.File({
    filename: path.join(logDir, 'security-audit.log'),
    level: 'info',
    maxsize: 5242880, // 5MB
    maxFiles: 10,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json(),
      winston.format((info) => {
        // Only log security-related events
        if (info.securityEvent) {
          return info;
        }
        return false;
      })()
    )
  }));
}

// Create a security logger wrapper
const securityLogger = {
  logAuthAttempt: (success, details) => {
    logger.info('Authentication attempt', {
      securityEvent: true,
      eventType: 'auth_attempt',
      success,
      ...details
    });
  },
  
  logOAuthFlow: (event, details) => {
    logger.info(`OAuth flow: ${event}`, {
      securityEvent: true,
      eventType: 'oauth_flow',
      event,
      ...details
    });
  },

  logTokenOperation: (operation, details) => {
    logger.info(`Token operation: ${operation}`, {
      securityEvent: true,
      eventType: 'token_operation',
      operation,
      ...details
    });
  },

  logSuspiciousActivity: (activity, details) => {
    logger.warn(`Suspicious activity: ${activity}`, {
      securityEvent: true,
      eventType: 'suspicious_activity',
      activity,
      ...details
    });
  }
};

// Stream for Morgan HTTP logger
const httpLogStream = {
  write: (message) => {
    logger.http(message.trim());
  }
};

module.exports = {
  logger,
  securityLogger,
  httpLogStream
};