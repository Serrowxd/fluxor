const Joi = require('joi');

const envSchema = Joi.object({
  // Core Application
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number()
    .integer()
    .min(1000)
    .max(65535)
    .default(3001),
  
  // Database
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required()
    .description('PostgreSQL connection string'),
  
  // Redis
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required()
    .description('Redis connection string'),
  
  // Security
  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .description('JWT signing secret (minimum 32 characters)'),
  JWT_EXPIRY: Joi.string()
    .pattern(/^\d+[hdm]$/)
    .default('24h')
    .description('JWT expiration time (e.g., 24h, 30d, 60m)'),
  ENCRYPTION_KEY: Joi.string()
    .min(32)
    .required()
    .description('Encryption key for sensitive data (minimum 32 characters)'),
  
  // External Services
  AI_SERVICE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required()
    .description('AI microservice URL for forecasting'),
  FRONTEND_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://localhost:3000')
    .description('Frontend application URL for CORS'),
  
  // Email Configuration (Optional)
  SMTP_HOST: Joi.string()
    .hostname()
    .optional()
    .description('SMTP server hostname'),
  SMTP_PORT: Joi.number()
    .integer()
    .min(1)
    .max(65535)
    .default(587)
    .description('SMTP server port'),
  SMTP_USER: Joi.string()
    .email()
    .optional()
    .description('SMTP username/email'),
  SMTP_PASS: Joi.string()
    .optional()
    .description('SMTP password'),
  SMTP_FROM: Joi.string()
    .email()
    .optional()
    .description('Default from email address'),
  
  // Development/Testing
  TEST_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .optional()
    .description('Test database connection string'),
  DB_USER: Joi.string()
    .optional()
    .description('Database username (used in test environment)'),
  DB_PASSWORD: Joi.string()
    .optional()
    .description('Database password (used in test environment)'),
  DB_HOST: Joi.string()
    .optional()
    .description('Database host (used in test environment)'),
  DB_PORT: Joi.string()
    .optional()
    .description('Database port (used in test environment)'),
  DB_NAME: Joi.string()
    .optional()
    .description('Database name (used in test environment)'),
}).unknown(true); // Allow other environment variables

class EnvValidator {
  static validate() {
    const { error, value } = envSchema.validate(process.env, {
      allowUnknown: true,
      stripUnknown: false,
      abortEarly: false,
    });

    if (error) {
      const errorMessages = error.details.map(detail => {
        const key = detail.path[0];
        const message = detail.message;
        const description = envSchema.describe().keys[key]?.flags?.description;
        
        return `${key}: ${message}${description ? ` (${description})` : ''}`;
      });

      throw new Error(`Environment validation failed:\n${errorMessages.join('\n')}`);
    }

    return value;
  }

  static validateRequired() {
    const requiredVars = [
      'DATABASE_URL',
      'REDIS_URL',
      'JWT_SECRET',
      'ENCRYPTION_KEY',
      'AI_SERVICE_URL'
    ];

    const missing = requiredVars.filter(varName => !process.env[varName]);

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  static validateSecurity() {
    const securityChecks = [];

    // Check JWT_SECRET strength
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
      securityChecks.push('JWT_SECRET should be at least 32 characters long');
    }

    // Check ENCRYPTION_KEY strength
    if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length < 32) {
      securityChecks.push('ENCRYPTION_KEY should be at least 32 characters long');
    }

    // Check for weak/default values
    const weakValues = ['password', 'secret', '123456', 'changeme', 'default'];
    weakValues.forEach(weak => {
      if (process.env.JWT_SECRET && process.env.JWT_SECRET.toLowerCase().includes(weak)) {
        securityChecks.push('JWT_SECRET appears to contain weak/default values');
      }
      if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.toLowerCase().includes(weak)) {
        securityChecks.push('ENCRYPTION_KEY appears to contain weak/default values');
      }
    });

    // Check production settings
    if (process.env.NODE_ENV === 'production') {
      if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')) {
        securityChecks.push('DATABASE_URL should not use localhost in production');
      }
      if (process.env.REDIS_URL && process.env.REDIS_URL.includes('localhost')) {
        securityChecks.push('REDIS_URL should not use localhost in production');
      }
      if (process.env.FRONTEND_URL && process.env.FRONTEND_URL.includes('localhost')) {
        console.warn('Warning: FRONTEND_URL uses localhost in production environment');
      }
    }

    if (securityChecks.length > 0) {
      throw new Error(`Security validation failed:\n${securityChecks.join('\n')}`);
    }
  }

  static init() {
    try {
      console.log('Validating environment variables...');
      
      // Run all validations
      this.validateRequired();
      this.validate();
      this.validateSecurity();
      
      console.log('✓ Environment validation passed');
      
      // Log environment info (without sensitive data)
      console.log(`Environment: ${process.env.NODE_ENV}`);
      console.log(`Port: ${process.env.PORT || 3001}`);
      console.log(`Database: ${process.env.DATABASE_URL ? 'configured' : 'not configured'}`);
      console.log(`Redis: ${process.env.REDIS_URL ? 'configured' : 'not configured'}`);
      console.log(`AI Service: ${process.env.AI_SERVICE_URL || 'not configured'}`);
      
    } catch (error) {
      console.error('Environment validation failed:');
      console.error(error.message);
      process.exit(1);
    }
  }

  static getSchema() {
    return envSchema.describe();
  }
}

module.exports = EnvValidator;