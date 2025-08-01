const { RouteType } = require('../types');
const path = require('path');

class RouteManager {
  constructor(config = {}) {
    this.config = config;
    this.routes = new Map();
    this.routePatterns = [];
    this.versions = new Map();
  }

  async initialize() {
    // Load routes from configuration
    if (this.config.routes) {
      for (const route of this.config.routes) {
        await this.addRoute(route);
      }
    }
  }

  async addRoute(route) {
    // Validate route
    this.validateRoute(route);

    // Generate route ID if not provided
    if (!route.id) {
      route.id = this.generateRouteId(route);
    }

    // Process route pattern
    const pattern = this.compilePattern(route.path);
    
    // Store route
    this.routes.set(route.id, {
      ...route,
      pattern,
      enabled: route.enabled !== false
    });

    // Update route patterns for matching
    this.updateRoutePatterns();

    // Track version
    if (route.version) {
      this.trackVersion(route.version);
    }

    return route.id;
  }

  async updateRoute(routeId, updates) {
    const route = this.routes.get(routeId);
    if (!route) {
      throw new Error(`Route not found: ${routeId}`);
    }

    // Merge updates
    const updatedRoute = { ...route, ...updates };
    
    // Revalidate
    this.validateRoute(updatedRoute);

    // Update pattern if path changed
    if (updates.path) {
      updatedRoute.pattern = this.compilePattern(updates.path);
    }

    // Store updated route
    this.routes.set(routeId, updatedRoute);

    // Update route patterns
    this.updateRoutePatterns();

    return updatedRoute;
  }

  async deleteRoute(routeId) {
    const route = this.routes.get(routeId);
    if (!route) {
      throw new Error(`Route not found: ${routeId}`);
    }

    this.routes.delete(routeId);
    this.updateRoutePatterns();

    return route;
  }

  getRoute(routeId) {
    return this.routes.get(routeId);
  }

  findRoute(request) {
    const { method, path: requestPath, headers } = request;
    const version = this.extractVersion(request);

    // Find matching routes
    const matches = this.routePatterns.filter(({ route }) => {
      // Check if route is enabled
      if (!route.enabled) {
        return false;
      }

      // Check method
      if (route.methods && !route.methods.includes(method) && !route.methods.includes('*')) {
        return false;
      }

      // Check version
      if (route.version && version && route.version !== version) {
        return false;
      }

      // Check path pattern
      return this.matchPath(requestPath, route.pattern);
    });

    if (matches.length === 0) {
      return null;
    }

    // Sort by specificity (more specific routes first)
    matches.sort((a, b) => {
      // Version-specific routes have higher priority
      if (a.route.version && !b.route.version) return -1;
      if (!a.route.version && b.route.version) return 1;
      
      // Longer paths are more specific
      return b.route.path.length - a.route.path.length;
    });

    const match = matches[0];
    const params = this.extractParams(requestPath, match.route.pattern);

    return {
      route: match.route,
      params
    };
  }

  validateRoute(route) {
    if (!route.path) {
      throw new Error('Route path is required');
    }

    if (!route.type || !Object.values(RouteType).includes(route.type)) {
      throw new Error(`Invalid route type: ${route.type}`);
    }

    if (route.type === RouteType.PROXY && !route.target) {
      throw new Error('Proxy routes require a target configuration');
    }

    if (route.methods) {
      const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', '*'];
      for (const method of route.methods) {
        if (!validMethods.includes(method)) {
          throw new Error(`Invalid HTTP method: ${method}`);
        }
      }
    }
  }

  compilePattern(pathPattern) {
    // Convert path parameters to regex
    // /users/:id -> /users/([^/]+)
    // /users/:id/posts/:postId -> /users/([^/]+)/posts/([^/]+)
    
    const paramNames = [];
    const regexPattern = pathPattern
      .replace(/:([a-zA-Z0-9_]+)/g, (match, paramName) => {
        paramNames.push(paramName);
        return '([^/]+)';
      })
      .replace(/\*/g, '(.*)'); // Wildcard support

    return {
      original: pathPattern,
      regex: new RegExp(`^${regexPattern}$`),
      paramNames
    };
  }

  matchPath(requestPath, pattern) {
    return pattern.regex.test(requestPath);
  }

  extractParams(requestPath, pattern) {
    const match = requestPath.match(pattern.regex);
    if (!match) {
      return {};
    }

    const params = {};
    pattern.paramNames.forEach((name, index) => {
      params[name] = match[index + 1];
    });

    return params;
  }

  extractVersion(request) {
    // Extract version from different sources
    const { headers, path: requestPath, query } = request;

    // 1. Accept header versioning
    if (headers.accept) {
      const versionMatch = headers.accept.match(/version=([^;,]+)/);
      if (versionMatch) {
        return versionMatch[1];
      }
    }

    // 2. Custom header versioning
    if (headers['x-api-version']) {
      return headers['x-api-version'];
    }

    // 3. URL path versioning
    const pathMatch = requestPath.match(/^\/v(\d+(?:\.\d+)?)\//);
    if (pathMatch) {
      return pathMatch[1];
    }

    // 4. Query parameter versioning
    if (query && query.version) {
      return query.version;
    }

    return null;
  }

  updateRoutePatterns() {
    this.routePatterns = Array.from(this.routes.values())
      .map(route => ({ route, pattern: route.pattern }));
  }

  generateRouteId(route) {
    const method = route.methods ? route.methods[0] : 'ANY';
    const pathSlug = route.path
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    
    return `${method.toLowerCase()}_${pathSlug}`;
  }

  trackVersion(version) {
    if (!this.versions.has(version)) {
      this.versions.set(version, {
        version,
        routes: 0,
        createdAt: new Date()
      });
    }

    const versionInfo = this.versions.get(version);
    versionInfo.routes++;
  }

  getVersions() {
    return Array.from(this.versions.values());
  }

  getRoutes(filters = {}) {
    let routes = Array.from(this.routes.values());

    // Apply filters
    if (filters.version) {
      routes = routes.filter(r => r.version === filters.version);
    }

    if (filters.type) {
      routes = routes.filter(r => r.type === filters.type);
    }

    if (filters.enabled !== undefined) {
      routes = routes.filter(r => r.enabled === filters.enabled);
    }

    if (filters.method) {
      routes = routes.filter(r => 
        r.methods && r.methods.includes(filters.method)
      );
    }

    if (filters.path) {
      routes = routes.filter(r => 
        r.path.includes(filters.path)
      );
    }

    return routes;
  }

  exportRoutes() {
    const routes = Array.from(this.routes.values());
    
    return {
      routes,
      versions: this.getVersions(),
      exportedAt: new Date()
    };
  }

  async importRoutes(data) {
    const { routes } = data;
    
    for (const route of routes) {
      await this.addRoute(route);
    }
  }

  generateOpenAPISpec() {
    const spec = {
      openapi: '3.0.0',
      info: {
        title: this.config.apiName || 'API Gateway',
        version: this.config.apiVersion || '1.0.0',
        description: this.config.apiDescription || 'API Gateway routes'
      },
      servers: [
        {
          url: this.config.baseUrl || 'http://localhost:3000',
          description: this.config.environment || 'Development'
        }
      ],
      paths: {}
    };

    // Group routes by path
    const pathGroups = {};
    
    for (const route of this.routes.values()) {
      if (!route.enabled || route.type !== RouteType.PROXY) {
        continue;
      }

      const pathKey = route.path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
      
      if (!pathGroups[pathKey]) {
        pathGroups[pathKey] = {};
      }

      const methods = route.methods || ['get'];
      
      for (const method of methods) {
        if (method === '*') continue;
        
        pathGroups[pathKey][method.toLowerCase()] = {
          summary: route.description || `${method} ${route.path}`,
          operationId: route.id,
          tags: route.metadata?.tags || [],
          parameters: this.generateParameters(route),
          responses: this.generateResponses(route),
          ...(route.validation?.body ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: route.validation.body
                }
              }
            }
          } : {})
        };
      }
    }

    spec.paths = pathGroups;
    return spec;
  }

  generateParameters(route) {
    const parameters = [];

    // Path parameters
    if (route.pattern.paramNames.length > 0) {
      for (const paramName of route.pattern.paramNames) {
        parameters.push({
          name: paramName,
          in: 'path',
          required: true,
          schema: { type: 'string' }
        });
      }
    }

    // Query parameters
    if (route.validation?.query) {
      // Convert Joi schema to OpenAPI parameters
      // This is a simplified version
      parameters.push({
        name: 'query',
        in: 'query',
        schema: route.validation.query
      });
    }

    // Header parameters
    if (route.validation?.headers) {
      // Convert header validation to parameters
    }

    return parameters;
  }

  generateResponses(route) {
    return {
      '200': {
        description: 'Successful response'
      },
      '400': {
        description: 'Bad request'
      },
      '401': {
        description: 'Unauthorized'
      },
      '404': {
        description: 'Not found'
      },
      '500': {
        description: 'Internal server error'
      }
    };
  }

  getMetrics() {
    const metrics = {
      totalRoutes: this.routes.size,
      enabledRoutes: Array.from(this.routes.values()).filter(r => r.enabled).length,
      routesByType: {},
      routesByVersion: {},
      routesByMethod: {}
    };

    for (const route of this.routes.values()) {
      // By type
      metrics.routesByType[route.type] = (metrics.routesByType[route.type] || 0) + 1;

      // By version
      if (route.version) {
        metrics.routesByVersion[route.version] = (metrics.routesByVersion[route.version] || 0) + 1;
      }

      // By method
      if (route.methods) {
        for (const method of route.methods) {
          metrics.routesByMethod[method] = (metrics.routesByMethod[method] || 0) + 1;
        }
      }
    }

    return metrics;
  }
}

module.exports = RouteManager;