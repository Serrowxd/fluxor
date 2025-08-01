const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { redisClient } = require('../../config/redis');
const axios = require('axios');

/**
 * Basic health check endpoint
 * GET /api/health
 */
router.get('/', async (req, res) => {
  try {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    };

    res.status(200).json(health);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * Detailed health check with dependency status
 * GET /api/health/detailed
 */
router.get('/detailed', async (req, res) => {
  const startTime = Date.now();
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    services: {}
  };

  let overallStatus = 'ok';
  
  // Check Database
  try {
    const dbStart = Date.now();
    await db.query('SELECT 1');
    health.services.database = {
      status: 'ok',
      responseTime: Date.now() - dbStart
    };
  } catch (error) {
    overallStatus = 'degraded';
    health.services.database = {
      status: 'error',
      error: error.message
    };
  }

  // Check Redis
  try {
    const redisStart = Date.now();
    await redisClient.ping();
    health.services.redis = {
      status: 'ok',
      responseTime: Date.now() - redisStart
    };
  } catch (error) {
    overallStatus = 'degraded';
    health.services.redis = {
      status: 'error',
      error: error.message
    };
  }

  // Check AI Service
  try {
    const aiStart = Date.now();
    const aiServiceUrl = process.env.AI_SERVICE_URL;
    if (aiServiceUrl) {
      await axios.get(`${aiServiceUrl}/health`, { timeout: 5000 });
      health.services.aiService = {
        status: 'ok',
        responseTime: Date.now() - aiStart
      };
    } else {
      health.services.aiService = {
        status: 'not_configured',
        message: 'AI_SERVICE_URL not configured'
      };
    }
  } catch (error) {
    overallStatus = 'degraded';
    health.services.aiService = {
      status: 'error',
      error: error.message
    };
  }

  // System metrics
  health.system = {
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      external: Math.round(process.memoryUsage().external / 1024 / 1024),
      unit: 'MB'
    },
    cpu: {
      usage: process.cpuUsage()
    },
    node: process.version
  };

  health.status = overallStatus;
  health.responseTime = Date.now() - startTime;

  const statusCode = overallStatus === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

/**
 * Readiness check - indicates if the service is ready to serve traffic
 * GET /api/health/ready
 */
router.get('/ready', async (req, res) => {
  try {
    // Check critical dependencies
    await db.query('SELECT 1');
    await redisClient.ping();

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * Liveness check - indicates if the service is alive
 * GET /api/health/live
 */
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * Database health check
 * GET /api/health/database
 */
router.get('/database', async (req, res) => {
  try {
    const start = Date.now();
    
    // Test basic connection
    await db.query('SELECT 1 as test');
    
    // Test a more complex query to check table existence
    const result = await db.query(`
      SELECT schemaname, tablename 
      FROM pg_catalog.pg_tables 
      WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
      LIMIT 5
    `);
    
    const responseTime = Date.now() - start;
    
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      responseTime,
      tables: result.rows.length,
      connection: 'active'
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * Redis health check
 * GET /api/health/redis
 */
router.get('/redis', async (req, res) => {
  try {
    const start = Date.now();
    
    // Test ping
    await redisClient.ping();
    
    // Test set/get operation
    const testKey = `health-check-${Date.now()}`;
    await redisClient.set(testKey, 'test', { EX: 10 });
    const testValue = await redisClient.get(testKey);
    await redisClient.del(testKey);
    
    const responseTime = Date.now() - start;
    
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      responseTime,
      operations: 'functional',
      test: testValue === 'test' ? 'passed' : 'failed'
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

module.exports = router;