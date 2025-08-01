/**
 * Authorization Middleware
 * Express middleware for authorization checks
 */

import { Request, Response, NextFunction } from 'express';
import { AuthorizationService, AuthorizationContext } from '../services/authorization.service';

export interface AuthorizedRequest extends Request {
  user?: {
    id: string;
    roles?: string[];
    [key: string]: any;
  };
  authorization?: {
    resource: string;
    action: string;
    context?: any;
  };
}

export interface AuthorizationOptions {
  resource?: string | ((req: AuthorizedRequest) => string);
  action?: string | ((req: AuthorizedRequest) => string);
  checkOwnership?: boolean;
  customCheck?: (req: AuthorizedRequest) => Promise<boolean>;
}

/**
 * Create authorization middleware
 */
export function authorizationMiddleware(authorizationService: AuthorizationService) {
  return function authorize(options: AuthorizationOptions = {}) {
    return async (req: AuthorizedRequest, res: Response, next: NextFunction) => {
      try {
        // Check if user is authenticated
        if (!req.user || !req.user.id) {
          return res.status(401).json({
            error: 'Authentication required',
            code: 'UNAUTHORIZED'
          });
        }

        // Determine resource and action
        const resource = typeof options.resource === 'function' 
          ? options.resource(req) 
          : options.resource || req.authorization?.resource || req.route?.path || 'unknown';
          
        const action = typeof options.action === 'function'
          ? options.action(req)
          : options.action || req.authorization?.action || req.method.toLowerCase() || 'unknown';

        // Build authorization context
        const context: AuthorizationContext = {
          user: {
            id: req.user.id,
            roles: req.user.roles,
            attributes: req.user
          },
          resource: {
            type: resource.split(':')[0],
            id: resource.split(':')[1],
            attributes: {
              method: req.method,
              path: req.path,
              params: req.params,
              query: req.query
            }
          },
          action,
          environment: {
            ip: req.ip,
            userAgent: req.get('user-agent'),
            timestamp: new Date().toISOString()
          }
        };

        // Check ownership if required
        if (options.checkOwnership) {
          const resourceId = req.params.id || req.params.userId;
          if (resourceId && resourceId !== req.user.id) {
            context.resource.attributes.ownerId = resourceId;
          }
        }

        // Perform authorization check
        const result = await authorizationService.authorize(context);

        if (!result.allowed) {
          // Check custom authorization if provided
          if (options.customCheck) {
            const customAllowed = await options.customCheck(req);
            if (customAllowed) {
              return next();
            }
          }

          return res.status(403).json({
            error: 'Access denied',
            code: 'FORBIDDEN',
            reason: result.reason,
            requiredPermissions: result.requiredPermissions
          });
        }

        // Attach authorization info to request
        req.authorization = {
          resource,
          action,
          context: result
        };

        next();
      } catch (error) {
        console.error('Authorization middleware error:', error);
        res.status(500).json({
          error: 'Authorization check failed',
          code: 'INTERNAL_ERROR'
        });
      }
    };
  };
}

/**
 * Require specific role
 */
export function requireRole(authorizationService: AuthorizationService, role: string) {
  return async (req: AuthorizedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'UNAUTHORIZED'
        });
      }

      const hasRole = await authorizationService.hasRole(req.user.id, role);

      if (!hasRole) {
        return res.status(403).json({
          error: 'Access denied',
          code: 'FORBIDDEN',
          reason: `Role '${role}' required`
        });
      }

      next();
    } catch (error) {
      console.error('Role check error:', error);
      res.status(500).json({
        error: 'Role check failed',
        code: 'INTERNAL_ERROR'
      });
    }
  };
}

/**
 * Require any of the specified roles
 */
export function requireAnyRole(authorizationService: AuthorizationService, roles: string[]) {
  return async (req: AuthorizedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'UNAUTHORIZED'
        });
      }

      const hasRole = await authorizationService.hasAnyRole(req.user.id, roles);

      if (!hasRole) {
        return res.status(403).json({
          error: 'Access denied',
          code: 'FORBIDDEN',
          reason: `One of these roles required: ${roles.join(', ')}`
        });
      }

      next();
    } catch (error) {
      console.error('Role check error:', error);
      res.status(500).json({
        error: 'Role check failed',
        code: 'INTERNAL_ERROR'
      });
    }
  };
}

/**
 * Require all of the specified roles
 */
export function requireAllRoles(authorizationService: AuthorizationService, roles: string[]) {
  return async (req: AuthorizedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'UNAUTHORIZED'
        });
      }

      const hasAllRoles = await authorizationService.hasAllRoles(req.user.id, roles);

      if (!hasAllRoles) {
        return res.status(403).json({
          error: 'Access denied',
          code: 'FORBIDDEN',
          reason: `All of these roles required: ${roles.join(', ')}`
        });
      }

      next();
    } catch (error) {
      console.error('Role check error:', error);
      res.status(500).json({
        error: 'Role check failed',
        code: 'INTERNAL_ERROR'
      });
    }
  };
}

/**
 * Require specific permission
 */
export function requirePermission(
  authorizationService: AuthorizationService,
  resource: string,
  action: string
) {
  return async (req: AuthorizedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'UNAUTHORIZED'
        });
      }

      const hasPermission = await authorizationService.hasPermission(
        req.user.id,
        resource,
        action
      );

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Access denied',
          code: 'FORBIDDEN',
          reason: `Permission required: ${resource}:${action}`
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({
        error: 'Permission check failed',
        code: 'INTERNAL_ERROR'
      });
    }
  };
}

/**
 * Optional authorization - continues even if authorization fails
 */
export function optionalAuthorization(authorizationService: AuthorizationService) {
  return function(options: AuthorizationOptions = {}) {
    const authorizeMiddleware = authorizationMiddleware(authorizationService)(options);
    
    return async (req: AuthorizedRequest, res: Response, next: NextFunction) => {
      // Create a mock response to catch authorization failures
      const mockRes: any = {
        status: () => mockRes,
        json: () => mockRes,
        send: () => mockRes
      };

      // Try authorization
      await authorizeMiddleware(req, mockRes, (err?: any) => {
        if (err) {
          req.authorization = {
            resource: '',
            action: '',
            context: { allowed: false, reason: 'Authorization failed' }
          };
        }
        next();
      });
    };
  };
}