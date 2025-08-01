/**
 * Tenant Management Middleware
 * @module tenant-management/middleware
 */

/**
 * Tenant isolation middleware
 * Ensures all requests are executed in proper tenant context
 */
const tenantIsolation = (tenantIsolation) => {
  return async (req, res, next) => {
    try {
      // Extract tenant ID from various sources
      const tenantId = req.headers['x-tenant-id'] || 
                      req.query.tenantId ||
                      req.params.tenantId ||
                      req.user?.tenantId;

      if (!tenantId) {
        return res.status(400).json({
          error: 'Tenant ID is required'
        });
      }

      // Set tenant context
      tenantIsolation.setContext({
        tenantId,
        userId: req.user?.id,
        permissions: req.user?.permissions || [],
        limits: req.tenant?.limits || {}
      });

      // Add tenant info to request
      req.tenantId = tenantId;
      req.tenantContext = tenantIsolation.getContext();

      // Clean up context after response
      res.on('finish', () => {
        tenantIsolation.clearContext();
      });

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Tenant authorization middleware
 * Validates user access to tenant
 */
const tenantAuthorization = (tenantService) => {
  return async (req, res, next) => {
    try {
      const { tenantId } = req;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          error: 'Authentication required'
        });
      }

      // Check if user belongs to tenant
      const tenantUsers = await tenantService.getTenantUsers(tenantId);
      const tenantUser = tenantUsers.find(tu => tu.userId === userId);

      if (!tenantUser) {
        return res.status(403).json({
          error: 'Access denied to this tenant'
        });
      }

      // Add tenant user info to request
      req.tenantUser = tenantUser;
      req.tenantRoles = tenantUser.roles;

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Resource quota middleware
 * Enforces resource limits
 */
const resourceQuota = (resourceQuota, tenantService) => {
  return (resource, amount = 1) => {
    return async (req, res, next) => {
      try {
        const { tenantId } = req;
        
        // Get tenant limits
        const tenant = await tenantService.getTenant(tenantId);
        if (!tenant) {
          return res.status(404).json({
            error: 'Tenant not found'
          });
        }

        // Check quota
        const allowed = await resourceQuota.enforceQuota(
          tenantId,
          resource,
          amount,
          tenant.limits
        );

        if (!allowed) {
          const usage = await resourceQuota.getUsage(tenantId);
          return res.status(429).json({
            error: 'Resource quota exceeded',
            resource,
            current: usage[resource],
            limit: tenant.limits[resource]
          });
        }

        // Update usage on response
        res.on('finish', async () => {
          if (res.statusCode < 400) {
            await resourceQuota.updateUsage(tenantId, resource, amount);
          }
        });

        next();
      } catch (error) {
        next(error);
      }
    };
  };
};

/**
 * Tenant status middleware
 * Ensures tenant is active
 */
const tenantStatus = (tenantService) => {
  return async (req, res, next) => {
    try {
      const { tenantId } = req;
      
      const tenant = await tenantService.getTenant(tenantId);
      if (!tenant) {
        return res.status(404).json({
          error: 'Tenant not found'
        });
      }

      if (tenant.status !== 'active') {
        return res.status(403).json({
          error: `Tenant is ${tenant.status}`,
          reason: tenant.suspensionReason
        });
      }

      // Check trial expiration
      if (tenant.trialEndsAt && new Date() > new Date(tenant.trialEndsAt)) {
        return res.status(403).json({
          error: 'Trial period expired'
        });
      }

      // Add tenant to request
      req.tenant = tenant;

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Cross-tenant access middleware
 * Validates cross-tenant operations
 */
const crossTenantAccess = (tenantIsolation) => {
  return (targetParam = 'targetTenantId') => {
    return async (req, res, next) => {
      try {
        const sourceTenantId = req.tenantId;
        const targetTenantId = req.params[targetParam] || 
                              req.body[targetParam] ||
                              req.query[targetParam];

        if (!targetTenantId) {
          return next();
        }

        const allowed = tenantIsolation.validateCrossTenantAccess(
          sourceTenantId,
          targetTenantId,
          req.method
        );

        if (!allowed) {
          return res.status(403).json({
            error: 'Cross-tenant access denied'
          });
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  };
};

/**
 * Feature flag middleware
 * Checks if tenant has access to feature
 */
const featureFlag = (tenantService) => {
  return (feature) => {
    return async (req, res, next) => {
      try {
        const { tenant } = req;
        
        if (!tenant) {
          const tenantId = req.tenantId;
          req.tenant = await tenantService.getTenant(tenantId);
        }

        if (!req.tenant.features[feature]) {
          return res.status(403).json({
            error: 'Feature not available',
            feature,
            message: 'This feature is not enabled for your tenant'
          });
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  };
};

module.exports = {
  tenantIsolation,
  tenantAuthorization,
  resourceQuota,
  tenantStatus,
  crossTenantAccess,
  featureFlag
};