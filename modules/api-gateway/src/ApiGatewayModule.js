const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const RouteManager = require('./services/RouteManager');
const ApiVersioning = require('./services/ApiVersioning');
const TransformationEngine = require('./services/TransformationEngine');
const ApiKeyManager = require('./services/ApiKeyManager');
const RequestValidator = require('./services/RequestValidator');
const ResponseTransformer = require('./services/ResponseTransformer');
const LoadBalancer = require('./services/LoadBalancer');
const ApiDocumentation = require('./services/ApiDocumentation');

class ApiGatewayModule {
  constructor(config = {}) {
    this.config = {
      port: 8080,
      basePath: '/api',
      enableVersioning: true,
      enableTransformations: true,
      enableApiKeys: true,
      enableDocumentation: true,
      enableLoadBalancing: true,
      enableRequestValidation: true,
      enableResponseTransformation: true,
      defaultVersion: 'v1',
      versionHeader: 'x-api-version',
      versionParam: 'version',
      apiKeyHeader: 'x-api-key',
      transformationRules: [],
      routes: [],
      upstreams: {},
      rateLimiting: {
        enabled: true,
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100
      },
      cors: {
        enabled: true,
        origin: '*',
        credentials: true
      },
      compression: {
        enabled: true,
        threshold: 1024
      },
      security: {
        helmet: true,
        hidePoweredBy: true
      },
      ...config
    };

    this.app = null;
    this.server = null;
    this.routeManager = null;
    this.apiVersioning = null;
    this.transformationEngine = null;
    this.apiKeyManager = null;
    this.requestValidator = null;
    this.responseTransformer = null;
    this.loadBalancer = null;
    this.apiDocumentation = null;
    this.dependencies = {};
    this.initialized = false;
  }

  async initialize(dependencies = {}) {
    if (this.initialized) {
      return;
    }

    this.dependencies = dependencies;

    // Initialize services
    await this.initializeServices();

    // Create Express app
    this.app = express();

    // Apply global middleware
    await this.applyGlobalMiddleware();

    // Setup routes
    await this.setupRoutes();

    // Setup API documentation
    if (this.config.enableDocumentation) {
      await this.setupDocumentation();
    }

    this.initialized = true;
  }

  async initializeServices() {
    // Initialize Route Manager
    this.routeManager = new RouteManager({
      basePath: this.config.basePath,
      routes: this.config.routes
    });

    // Initialize API Versioning
    if (this.config.enableVersioning) {
      this.apiVersioning = new ApiVersioning({
        defaultVersion: this.config.defaultVersion,
        versionHeader: this.config.versionHeader,
        versionParam: this.config.versionParam,
        supportedVersions: this.config.supportedVersions
      });
    }

    // Initialize Transformation Engine
    if (this.config.enableTransformations) {
      this.transformationEngine = new TransformationEngine({
        rules: this.config.transformationRules
      });
    }

    // Initialize API Key Manager
    if (this.config.enableApiKeys) {
      this.apiKeyManager = new ApiKeyManager({
        header: this.config.apiKeyHeader,
        database: this.dependencies.database,
        cache: this.dependencies.cache
      });
      await this.apiKeyManager.initialize();
    }

    // Initialize Request Validator
    if (this.config.enableRequestValidation) {
      this.requestValidator = new RequestValidator({
        schemas: this.config.validationSchemas
      });
    }

    // Initialize Response Transformer
    if (this.config.enableResponseTransformation) {
      this.responseTransformer = new ResponseTransformer({
        transformations: this.config.responseTransformations
      });
    }

    // Initialize Load Balancer
    if (this.config.enableLoadBalancing && this.dependencies.serviceRegistry) {
      this.loadBalancer = new LoadBalancer({
        serviceRegistry: this.dependencies.serviceRegistry,
        strategy: this.config.loadBalancingStrategy || 'round-robin',
        healthCheckInterval: this.config.healthCheckInterval || 30000
      });
      await this.loadBalancer.initialize();
    }

    // Initialize API Documentation
    if (this.config.enableDocumentation) {
      this.apiDocumentation = new ApiDocumentation({
        title: this.config.documentationTitle || 'Fluxor API Gateway',
        description: this.config.documentationDescription || 'API Gateway for Fluxor services',
        version: this.config.documentationVersion || '1.0.0',
        servers: this.config.documentationServers || [{
          url: `http://localhost:${this.config.port}`,
          description: 'Local server'
        }]
      });
    }
  }

  async applyGlobalMiddleware() {
    const helmet = require('helmet');
    const cors = require('cors');
    const compression = require('compression');

    // Body parsing
    this.app.use(express.json({ limit: this.config.bodyLimit || '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: this.config.bodyLimit || '10mb' }));

    // Security
    if (this.config.security.helmet) {
      this.app.use(helmet());
    }

    if (this.config.security.hidePoweredBy) {
      this.app.disable('x-powered-by');
    }

    // CORS
    if (this.config.cors.enabled) {
      this.app.use(cors(this.config.cors));
    }

    // Compression
    if (this.config.compression.enabled) {
      this.app.use(compression(this.config.compression));
    }

    // Request ID
    this.app.use((req, res, next) => {
      req.id = req.headers['x-request-id'] || require('uuid').v4();
      res.setHeader('x-request-id', req.id);
      next();
    });

    // Logging
    if (this.dependencies.logger) {
      this.app.use((req, res, next) => {
        const startTime = Date.now();
        
        res.on('finish', () => {
          const duration = Date.now() - startTime;
          this.dependencies.logger.info('Request completed', {
            requestId: req.id,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration,
            userAgent: req.headers['user-agent'],
            ip: req.ip
          });
        });
        
        next();
      });
    }

    // API Key validation
    if (this.config.enableApiKeys) {
      this.app.use(this.apiKeyManager.middleware());
    }

    // Rate limiting
    if (this.config.rateLimiting.enabled) {
      const rateLimit = require('express-rate-limit');
      const limiter = rateLimit({
        windowMs: this.config.rateLimiting.windowMs,
        max: this.config.rateLimiting.max,
        message: 'Too many requests from this IP',
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => {
          return req.apiKey?.id || req.ip;
        },
        skip: (req) => {
          return req.apiKey?.unlimited === true;
        }
      });
      this.app.use(limiter);
    }

    // API Versioning
    if (this.config.enableVersioning) {
      this.app.use(this.apiVersioning.middleware());
    }
  }

  async setupRoutes() {
    const routes = await this.routeManager.getRoutes();

    for (const route of routes) {
      await this.setupRoute(route);
    }

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: this.config.version || '1.0.0'
      });
    });

    // Metrics endpoint
    if (this.dependencies.monitoring) {
      this.app.get('/metrics', async (req, res) => {
        const metrics = await this.getMetrics();
        res.json(metrics);
      });
    }

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
        requestId: req.id
      });
    });

    // Error handler
    this.app.use((err, req, res, next) => {
      if (this.dependencies.logger) {
        this.dependencies.logger.error('Request error', {
          requestId: req.id,
          error: err.message,
          stack: err.stack
        });
      }

      res.status(err.status || 500).json({
        error: err.name || 'Internal Server Error',
        message: err.message || 'An unexpected error occurred',
        requestId: req.id
      });
    });
  }

  async setupRoute(route) {
    const {
      path,
      method = 'all',
      target,
      middleware = [],
      validation,
      transformation,
      rateLimit,
      authentication,
      authorization,
      cache,
      timeout = 30000
    } = route;

    const handlers = [];

    // Custom middleware
    handlers.push(...middleware);

    // Request validation
    if (validation && this.config.enableRequestValidation) {
      handlers.push(this.requestValidator.validate(validation));
    }

    // Authentication
    if (authentication && this.dependencies.authentication) {
      handlers.push(this.dependencies.authentication.middleware(authentication));
    }

    // Authorization
    if (authorization && this.dependencies.authorization) {
      handlers.push(this.dependencies.authorization.middleware(authorization));
    }

    // Custom rate limiting for route
    if (rateLimit && this.config.rateLimiting.enabled) {
      const rateLimit = require('express-rate-limit');
      const limiter = rateLimit({
        ...this.config.rateLimiting,
        ...rateLimit
      });
      handlers.push(limiter);
    }

    // Caching
    if (cache && this.dependencies.cache) {
      handlers.push(this.createCacheMiddleware(cache));
    }

    // Request transformation
    if (transformation?.request && this.config.enableTransformations) {
      handlers.push(this.transformationEngine.transformRequest(transformation.request));
    }

    // Proxy or handler
    if (target) {
      if (typeof target === 'string') {
        // Proxy to upstream service
        handlers.push(await this.createProxyMiddleware(target, route));
      } else if (typeof target === 'function') {
        // Custom handler function
        handlers.push(target);
      } else if (target.service) {
        // Service discovery based routing
        handlers.push(await this.createServiceProxyMiddleware(target.service, route));
      }
    }

    // Response transformation
    if (transformation?.response && this.config.enableResponseTransformation) {
      handlers.push(this.responseTransformer.transform(transformation.response));
    }

    // Register route
    const fullPath = this.config.basePath + path;
    this.app[method.toLowerCase()](fullPath, ...handlers);
  }

  async createProxyMiddleware(target, route) {
    const options = {
      target,
      changeOrigin: true,
      timeout: route.timeout || this.config.defaultTimeout || 30000,
      proxyTimeout: route.timeout || this.config.defaultTimeout || 30000,
      onProxyReq: (proxyReq, req, res) => {
        // Add forwarded headers
        proxyReq.setHeader('X-Forwarded-For', req.ip);
        proxyReq.setHeader('X-Forwarded-Proto', req.protocol);
        proxyReq.setHeader('X-Forwarded-Host', req.headers.host);
        proxyReq.setHeader('X-Request-Id', req.id);

        // Add API version if enabled
        if (this.config.enableVersioning && req.apiVersion) {
          proxyReq.setHeader(this.config.versionHeader, req.apiVersion);
        }
      },
      onProxyRes: (proxyRes, req, res) => {
        // Log proxy response
        if (this.dependencies.logger) {
          this.dependencies.logger.debug('Proxy response', {
            requestId: req.id,
            target,
            statusCode: proxyRes.statusCode
          });
        }
      },
      onError: (err, req, res) => {
        if (this.dependencies.logger) {
          this.dependencies.logger.error('Proxy error', {
            requestId: req.id,
            target,
            error: err.message
          });
        }

        res.status(502).json({
          error: 'Bad Gateway',
          message: 'Failed to proxy request to upstream service',
          requestId: req.id
        });
      }
    };

    return createProxyMiddleware(options);
  }

  async createServiceProxyMiddleware(serviceName, route) {
    return async (req, res, next) => {
      try {
        // Get service instance from load balancer
        const instance = await this.loadBalancer.getInstance(serviceName);
        
        if (!instance) {
          return res.status(503).json({
            error: 'Service Unavailable',
            message: `No healthy instances of service ${serviceName} available`,
            requestId: req.id
          });
        }

        // Create proxy middleware for the instance
        const target = `${instance.protocol || 'http'}://${instance.host}:${instance.port}`;
        const proxyMiddleware = await this.createProxyMiddleware(target, route);
        
        // Execute proxy
        proxyMiddleware(req, res, next);
      } catch (error) {
        next(error);
      }
    };
  }

  createCacheMiddleware(cacheConfig) {
    return async (req, res, next) => {
      // Only cache GET requests
      if (req.method !== 'GET') {
        return next();
      }

      const cacheKey = this.generateCacheKey(req, cacheConfig);
      
      try {
        // Check cache
        const cached = await this.dependencies.cache.get(cacheKey);
        
        if (cached) {
          const data = JSON.parse(cached);
          res.set(data.headers);
          res.set('X-Cache-Hit', 'true');
          return res.status(data.statusCode).json(data.body);
        }
      } catch (error) {
        if (this.dependencies.logger) {
          this.dependencies.logger.error('Cache error', {
            requestId: req.id,
            error: error.message
          });
        }
      }

      // Store original send function
      const originalSend = res.json;
      
      // Override send to cache response
      res.json = function(body) {
        // Cache successful responses only
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const data = {
            statusCode: res.statusCode,
            headers: res.getHeaders(),
            body
          };
          
          // Store in cache (fire and forget)
          this.dependencies.cache.set(
            cacheKey,
            JSON.stringify(data),
            cacheConfig.ttl || 300
          ).catch(err => {
            if (this.dependencies.logger) {
              this.dependencies.logger.error('Failed to cache response', {
                requestId: req.id,
                error: err.message
              });
            }
          });
        }
        
        // Call original send
        return originalSend.call(res, body);
      }.bind(this);
      
      res.set('X-Cache-Hit', 'false');
      next();
    };
  }

  generateCacheKey(req, cacheConfig) {
    const parts = [
      'apigw',
      req.method,
      req.path,
      req.apiVersion || 'default'
    ];

    // Include query parameters if specified
    if (cacheConfig.includeQuery) {
      const queryKeys = Object.keys(req.query).sort();
      const queryString = queryKeys
        .map(key => `${key}=${req.query[key]}`)
        .join('&');
      parts.push(queryString);
    }

    // Include headers if specified
    if (cacheConfig.includeHeaders) {
      const headers = Array.isArray(cacheConfig.includeHeaders)
        ? cacheConfig.includeHeaders
        : ['accept', 'accept-language'];
      
      headers.forEach(header => {
        if (req.headers[header]) {
          parts.push(`${header}:${req.headers[header]}`);
        }
      });
    }

    // Include user/tenant context if available
    if (cacheConfig.perUser && req.user?.id) {
      parts.push(`user:${req.user.id}`);
    }
    
    if (cacheConfig.perTenant && req.tenant?.id) {
      parts.push(`tenant:${req.tenant.id}`);
    }

    return parts.join(':');
  }

  async setupDocumentation() {
    const swaggerUi = require('swagger-ui-express');
    const swaggerSpec = await this.apiDocumentation.generateSpec(this.routeManager.getRoutes());
    
    this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: this.config.documentationTitle || 'API Documentation'
    }));

    // Serve OpenAPI spec
    this.app.get('/api-docs.json', (req, res) => {
      res.json(swaggerSpec);
    });

    this.app.get('/api-docs.yaml', (req, res) => {
      const yaml = require('yamljs');
      res.type('text/yaml').send(yaml.stringify(swaggerSpec, 4));
    });
  }

  async start() {
    if (!this.initialized) {
      throw new Error('API Gateway not initialized');
    }

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.config.port, this.config.host || '0.0.0.0', (err) => {
        if (err) {
          return reject(err);
        }

        if (this.dependencies.logger) {
          this.dependencies.logger.info('API Gateway started', {
            port: this.config.port,
            host: this.config.host || '0.0.0.0',
            basePath: this.config.basePath,
            environment: process.env.NODE_ENV || 'development'
          });
        }

        resolve(this.server);
      });
    });
  }

  async stop() {
    if (!this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server.close(() => {
        if (this.dependencies.logger) {
          this.dependencies.logger.info('API Gateway stopped');
        }
        resolve();
      });
    });
  }

  async addRoute(route) {
    await this.routeManager.addRoute(route);
    await this.setupRoute(route);
  }

  async removeRoute(routeId) {
    await this.routeManager.removeRoute(routeId);
    // Note: Express doesn't support removing routes, would need to restart
  }

  async updateRoute(routeId, updates) {
    await this.routeManager.updateRoute(routeId, updates);
    // Note: Express doesn't support updating routes, would need to restart
  }

  async getMetrics() {
    const metrics = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      routes: {
        total: this.routeManager.getRoutes().length,
        byMethod: {}
      },
      apiKeys: {}
    };

    // Count routes by method
    const routes = this.routeManager.getRoutes();
    routes.forEach(route => {
      const method = route.method || 'all';
      metrics.routes.byMethod[method] = (metrics.routes.byMethod[method] || 0) + 1;
    });

    // API key metrics
    if (this.apiKeyManager) {
      metrics.apiKeys = await this.apiKeyManager.getMetrics();
    }

    // Load balancer metrics
    if (this.loadBalancer) {
      metrics.loadBalancing = await this.loadBalancer.getMetrics();
    }

    return metrics;
  }
}

module.exports = ApiGatewayModule;