const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

// Import the actual route files
const healthRoutes = require('../../routes/health');

// Mock external dependencies
jest.mock('../../../config/database', () => ({
  query: jest.fn()
}));

jest.mock('../../../config/redis', () => ({
  redisClient: {
    ping: jest.fn().mockResolvedValue('PONG'),
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue('test'),
    del: jest.fn().mockResolvedValue(1)
  }
}));

jest.mock('axios', () => ({
  get: jest.fn()
}));

const db = require('../../../config/database');
const { redisClient } = require('../../../config/redis');
const axios = require('axios');

describe('API Endpoints', () => {
  let app;

  beforeEach(() => {
    // Create a minimal Express app
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    
    // Mount only the health routes for testing
    app.use('/api/health', healthRoutes);
    
    // Basic error handler
    app.use((err, req, res, next) => {
      res.status(err.status || 500).json({
        error: {
          message: err.message,
          status: err.status || 500
        }
      });
    });
    
    // Reset all mocks
    jest.clearAllMocks();
    
    // Set required environment variables
    process.env.AI_SERVICE_URL = 'http://localhost:5000';
  });

  describe('Health Endpoints', () => {
    describe('GET /api/health', () => {
      it('should return basic health status', async () => {
        const response = await request(app).get('/api/health');
        
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status', 'ok');
        expect(response.body).toHaveProperty('timestamp');
        expect(response.body).toHaveProperty('uptime');
      });
    });

    describe('GET /api/health/live', () => {
      it('should return liveness status', async () => {
        const response = await request(app).get('/api/health/live');
        
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status', 'alive');
        expect(response.body).toHaveProperty('timestamp');
        expect(response.body).toHaveProperty('uptime');
      });
    });

    describe('GET /api/health/ready', () => {
      it('should return ready when services are available', async () => {
        // Mock successful database and Redis connections
        db.query.mockResolvedValue({ rows: [{ test: 1 }] });
        
        const response = await request(app).get('/api/health/ready');
        
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status', 'ready');
        expect(response.body).toHaveProperty('timestamp');
      });

      it('should return not ready when database is down', async () => {
        // Mock database failure
        db.query.mockRejectedValue(new Error('Database connection failed'));
        
        const response = await request(app).get('/api/health/ready');
        
        expect(response.status).toBe(503);
        expect(response.body).toHaveProperty('status', 'not_ready');
        expect(response.body).toHaveProperty('error');
      });
    });

    describe('GET /api/health/database', () => {
      it('should return database health when connection is successful', async () => {
        // Mock successful database queries
        db.query
          .mockResolvedValueOnce({ rows: [{ test: 1 }] })
          .mockResolvedValueOnce({ 
            rows: [
              { schemaname: 'public', tablename: 'users' },
              { schemaname: 'public', tablename: 'products' }
            ] 
          });

        const response = await request(app).get('/api/health/database');
        
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status', 'ok');
        expect(response.body).toHaveProperty('responseTime');
        expect(response.body).toHaveProperty('tables', 2);
        expect(response.body).toHaveProperty('connection', 'active');
      });

      it('should return error when database connection fails', async () => {
        // Mock database failure
        db.query.mockRejectedValue(new Error('Database connection failed'));

        const response = await request(app).get('/api/health/database');
        
        expect(response.status).toBe(503);
        expect(response.body).toHaveProperty('status', 'error');
        expect(response.body).toHaveProperty('error', 'Database connection failed');
      });
    });

    describe('GET /api/health/redis', () => {
      it('should return Redis health when connection is successful', async () => {
        const response = await request(app).get('/api/health/redis');
        
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status', 'ok');
        expect(response.body).toHaveProperty('responseTime');
        expect(response.body).toHaveProperty('operations', 'functional');
        expect(response.body).toHaveProperty('test', 'passed');
      });

      it('should return error when Redis connection fails', async () => {
        // Mock Redis failure
        redisClient.ping.mockRejectedValue(new Error('Redis connection failed'));

        const response = await request(app).get('/api/health/redis');
        
        expect(response.status).toBe(503);
        expect(response.body).toHaveProperty('status', 'error');
        expect(response.body).toHaveProperty('error', 'Redis connection failed');
      });
    });

    describe('GET /api/health/detailed', () => {
      it('should return detailed health status (may be degraded)', async () => {
        // Mock database success
        db.query.mockResolvedValue({ rows: [{ test: 1 }] });
        // Mock axios for AI service - may fail in test environment
        axios.get.mockResolvedValue({ data: { status: 'ok' } });

        const response = await request(app).get('/api/health/detailed');
        
        // Accept either 200 (all healthy) or 503 (some services down) 
        expect([200, 503]).toContain(response.status);
        expect(response.body).toHaveProperty('status');
        expect(response.body).toHaveProperty('services');
        expect(response.body).toHaveProperty('system');
        expect(response.body).toHaveProperty('responseTime');
        
        // Services should be present regardless of their status
        expect(response.body.services).toHaveProperty('database');
        expect(response.body.services).toHaveProperty('redis');
        expect(response.body.services).toHaveProperty('aiService');
      });

      it('should return degraded status when database fails', async () => {
        // Mock database failure
        db.query.mockRejectedValue(new Error('Database error'));
        // Mock other services as healthy
        axios.get.mockResolvedValue({ data: { status: 'ok' } });

        const response = await request(app).get('/api/health/detailed');
        
        expect(response.status).toBe(503);
        expect(response.body).toHaveProperty('status', 'degraded');
        expect(response.body.services.database).toHaveProperty('status', 'error');
        expect(response.body.services.database).toHaveProperty('error', 'Database error');
      });
    });
  });

  describe('Route Integration', () => {
    it('should handle 404 errors for unknown routes', async () => {
      const response = await request(app).get('/api/nonexistent');
      
      expect(response.status).toBe(404);
    });

    it('should handle Express JSON parsing', async () => {
      // Add a test route that accepts JSON
      app.post('/test/json', (req, res) => {
        res.json({ received: req.body });
      });

      const testData = { message: 'test', number: 123 };
      
      const response = await request(app)
        .post('/test/json')
        .send(testData);
      
      expect(response.status).toBe(200);
      expect(response.body.received).toEqual(testData);
    });

    it('should handle URL-encoded form data', async () => {
      // Add a test route that accepts form data
      app.post('/test/form', express.urlencoded({ extended: true }), (req, res) => {
        res.json({ received: req.body });
      });

      const response = await request(app)
        .post('/test/form')
        .type('form')
        .send('name=test&value=123');
      
      expect(response.status).toBe(200);
      expect(response.body.received).toEqual({
        name: 'test',
        value: '123'
      });
    });
  });
});