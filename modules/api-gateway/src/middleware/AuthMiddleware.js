const { AuthStrategy } = require('../types');

class AuthMiddleware {
  constructor(config = {}) {
    this.config = config;
    this.strategies = new Map();
    
    // Register default strategies
    this.registerDefaultStrategies();
  }

  registerDefaultStrategies() {
    // No auth
    this.registerStrategy(AuthStrategy.NONE, {
      authenticate: async (request) => ({ authenticated: true })
    });

    // API Key authentication
    this.registerStrategy(AuthStrategy.API_KEY, {
      authenticate: async (request, config) => {
        const apiKey = this.extractApiKey(request, config);
        
        if (!apiKey) {
          return {
            authenticated: false,
            error: 'API key required'
          };
        }

        // Validate API key
        const isValid = await this.validateApiKey(apiKey, config);
        
        if (!isValid) {
          return {
            authenticated: false,
            error: 'Invalid API key'
          };
        }

        return {
          authenticated: true,
          principal: {
            type: 'api_key',
            apiKey: apiKey
          }
        };
      }
    });

    // JWT authentication
    this.registerStrategy(AuthStrategy.JWT, {
      authenticate: async (request, config) => {
        const token = this.extractJWT(request, config);
        
        if (!token) {
          return {
            authenticated: false,
            error: 'JWT token required'
          };
        }

        try {
          const decoded = await this.verifyJWT(token, config);
          
          return {
            authenticated: true,
            principal: {
              type: 'jwt',
              ...decoded
            }
          };
        } catch (error) {
          return {
            authenticated: false,
            error: 'Invalid JWT token'
          };
        }
      }
    });

    // Basic authentication
    this.registerStrategy(AuthStrategy.BASIC, {
      authenticate: async (request, config) => {
        const credentials = this.extractBasicAuth(request);
        
        if (!credentials) {
          return {
            authenticated: false,
            error: 'Basic authentication required',
            headers: {
              'WWW-Authenticate': 'Basic realm="API Gateway"'
            }
          };
        }

        const isValid = await this.validateBasicAuth(
          credentials.username,
          credentials.password,
          config
        );

        if (!isValid) {
          return {
            authenticated: false,
            error: 'Invalid credentials',
            headers: {
              'WWW-Authenticate': 'Basic realm="API Gateway"'
            }
          };
        }

        return {
          authenticated: true,
          principal: {
            type: 'basic',
            username: credentials.username
          }
        };
      }
    });

    // OAuth authentication
    this.registerStrategy(AuthStrategy.OAUTH, {
      authenticate: async (request, config) => {
        const token = this.extractOAuthToken(request);
        
        if (!token) {
          return {
            authenticated: false,
            error: 'OAuth token required'
          };
        }

        try {
          const tokenInfo = await this.validateOAuthToken(token, config);
          
          return {
            authenticated: true,
            principal: {
              type: 'oauth',
              ...tokenInfo
            }
          };
        } catch (error) {
          return {
            authenticated: false,
            error: 'Invalid OAuth token'
          };
        }
      }
    });
  }

  registerStrategy(name, strategy) {
    this.strategies.set(name, strategy);
  }

  async authenticate(request, authConfig) {
    if (!authConfig || authConfig.strategy === AuthStrategy.NONE) {
      return { authenticated: true };
    }

    const strategy = this.strategies.get(authConfig.strategy);
    
    if (!strategy) {
      throw new Error(`Unknown authentication strategy: ${authConfig.strategy}`);
    }

    const result = await strategy.authenticate(request, authConfig);
    
    // Store authentication result in request
    if (result.authenticated && result.principal) {
      request.user = result.principal;
    }

    return result;
  }

  // API Key extraction and validation
  extractApiKey(request, config) {
    const { header = 'X-API-Key', query = 'api_key' } = config;

    // Check header first
    if (request.headers[header.toLowerCase()]) {
      return request.headers[header.toLowerCase()];
    }

    // Check query parameter
    if (request.query && request.query[query]) {
      return request.query[query];
    }

    return null;
  }

  async validateApiKey(apiKey, config) {
    if (config.validator) {
      return await config.validator(apiKey);
    }

    // Simple validation against configured keys
    if (config.validKeys) {
      return config.validKeys.includes(apiKey);
    }

    // Check against key store
    if (this.config.keyStore) {
      return await this.config.keyStore.validate(apiKey);
    }

    return false;
  }

  // JWT extraction and validation
  extractJWT(request, config) {
    const { header = 'Authorization', scheme = 'Bearer' } = config;
    
    const authHeader = request.headers[header.toLowerCase()];
    if (!authHeader) {
      return null;
    }

    if (scheme) {
      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== scheme) {
        return null;
      }
      return parts[1];
    }

    return authHeader;
  }

  async verifyJWT(token, config) {
    if (config.validator) {
      return await config.validator(token);
    }

    // Use configured JWT service
    if (this.config.jwtService) {
      return await this.config.jwtService.verify(token, config);
    }

    throw new Error('No JWT validator configured');
  }

  // Basic auth extraction and validation
  extractBasicAuth(request) {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return null;
    }

    const base64Credentials = authHeader.substring(6);
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
    const [username, password] = credentials.split(':');

    return { username, password };
  }

  async validateBasicAuth(username, password, config) {
    if (config.validator) {
      return await config.validator(username, password);
    }

    // Check against configured users
    if (config.users) {
      const user = config.users[username];
      return user && user.password === password;
    }

    // Check against user store
    if (this.config.userStore) {
      return await this.config.userStore.validate(username, password);
    }

    return false;
  }

  // OAuth token extraction and validation
  extractOAuthToken(request) {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    return authHeader.substring(7);
  }

  async validateOAuthToken(token, config) {
    if (config.validator) {
      return await config.validator(token);
    }

    // Validate against OAuth provider
    if (config.introspectionEndpoint) {
      const response = await fetch(config.introspectionEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(
            `${config.clientId}:${config.clientSecret}`
          ).toString('base64')}`
        },
        body: `token=${token}`
      });

      const data = await response.json();
      
      if (!data.active) {
        throw new Error('Token is not active');
      }

      return data;
    }

    throw new Error('No OAuth validator configured');
  }

  // Create middleware function
  createMiddleware(authConfig) {
    return async (req, res, next) => {
      try {
        const result = await this.authenticate(req, authConfig);
        
        if (!result.authenticated) {
          // Add any custom headers
          if (result.headers) {
            Object.entries(result.headers).forEach(([key, value]) => {
              res.setHeader(key, value);
            });
          }

          return res.status(401).json({
            error: result.error || 'Authentication required'
          });
        }

        next();
      } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({
          error: 'Authentication service error'
        });
      }
    };
  }

  // Check authorization
  async authorize(request, authorizationConfig) {
    if (!request.user) {
      return { authorized: false, error: 'Not authenticated' };
    }

    if (!authorizationConfig) {
      return { authorized: true };
    }

    // Check roles
    if (authorizationConfig.roles) {
      const userRoles = request.user.roles || [];
      const hasRole = authorizationConfig.roles.some(role => 
        userRoles.includes(role)
      );
      
      if (!hasRole) {
        return {
          authorized: false,
          error: 'Insufficient roles'
        };
      }
    }

    // Check permissions
    if (authorizationConfig.permissions) {
      const userPermissions = request.user.permissions || [];
      const hasPermission = authorizationConfig.permissions.every(permission =>
        userPermissions.includes(permission)
      );
      
      if (!hasPermission) {
        return {
          authorized: false,
          error: 'Insufficient permissions'
        };
      }
    }

    // Custom authorization
    if (authorizationConfig.custom) {
      const result = await authorizationConfig.custom(request.user, request);
      if (!result) {
        return {
          authorized: false,
          error: 'Custom authorization failed'
        };
      }
    }

    return { authorized: true };
  }
}

module.exports = AuthMiddleware;