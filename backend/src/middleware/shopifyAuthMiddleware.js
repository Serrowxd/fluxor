const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { redisClient } = require('../../config/redis');
const { logger, securityLogger } = require('../utils/logger');
const { ShopifyError, RateLimitError } = require('../utils/errors');

/**
 * Rate limiter for OAuth attempts
 * Max 10 attempts per IP per hour
 */
const oauthRateLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:shopify:oauth:'
  }),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    const ip = req.ip;
    securityLogger.logSuspiciousActivity('OAuth rate limit exceeded', {
      ip,
      shop: req.body?.shop,
      userId: req.user?.id
    });
    next(new RateLimitError('Too many OAuth attempts. Please try again later.', 3600));
  },
  skip: (req) => {
    // Skip rate limiting in test environment
    return process.env.NODE_ENV === 'test';
  }
});

/**
 * IP-based blocking for suspicious activity
 */
const suspiciousActivityMiddleware = async (req, res, next) => {
  try {
    const ip = req.ip;
    const blockedKey = `shopify:blocked:ip:${ip}`;
    
    // Check if IP is blocked
    const isBlocked = await redisClient.get(blockedKey);
    if (isBlocked) {
      securityLogger.logSuspiciousActivity('Blocked IP attempted access', {
        ip,
        shop: req.body?.shop || req.query?.shop,
        blockedUntil: isBlocked
      });
      
      return next(new ShopifyError('Access denied due to suspicious activity', 'ACCESS_DENIED'));
    }

    // Track failed attempts
    const failedAttemptsKey = `shopify:failed:ip:${ip}`;
    const failedAttempts = await redisClient.get(failedAttemptsKey);
    
    if (failedAttempts && parseInt(failedAttempts) >= 5) {
      // Block IP for 24 hours after 5 failed attempts
      await redisClient.setEx(blockedKey, 86400, new Date(Date.now() + 86400000).toISOString());
      
      securityLogger.logSuspiciousActivity('IP blocked due to multiple failures', {
        ip,
        failedAttempts: parseInt(failedAttempts)
      });
      
      return next(new ShopifyError('Access blocked due to multiple failed attempts', 'ACCESS_BLOCKED'));
    }

    next();
  } catch (error) {
    logger.error('Error in suspicious activity middleware', { error: error.message });
    // Don't block the request if there's an error checking
    next();
  }
};

/**
 * Audit logging middleware for all authentication attempts
 */
const auditLoggingMiddleware = (req, res, next) => {
  const startTime = Date.now();
  const originalJson = res.json;
  const originalRedirect = res.redirect;

  // Log request
  securityLogger.logOAuthFlow('request', {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    shop: req.body?.shop || req.query?.shop,
    userId: req.user?.id,
    endpoint: req.path
  });

  // Override response methods to log response
  res.json = function(data) {
    const duration = Date.now() - startTime;
    const success = !data?.error;
    
    securityLogger.logOAuthFlow('response', {
      ip: req.ip,
      shop: req.body?.shop || req.query?.shop,
      userId: req.user?.id,
      endpoint: req.path,
      success,
      duration,
      statusCode: res.statusCode
    });

    return originalJson.call(this, data);
  };

  res.redirect = function(url) {
    const duration = Date.now() - startTime;
    const success = !url.includes('/error');
    
    securityLogger.logOAuthFlow('redirect', {
      ip: req.ip,
      shop: req.query?.shop,
      endpoint: req.path,
      success,
      duration,
      redirectUrl: url.split('?')[0] // Log URL without params
    });

    return originalRedirect.call(this, url);
  };

  next();
};

/**
 * CORS configuration for Shopify embedded apps
 */
const shopifyCorsMiddleware = (req, res, next) => {
  // Set CSP headers for iframe embedding
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://*.myshopify.com https://admin.shopify.com"
  );
  
  // Set X-Frame-Options for older browsers
  res.setHeader('X-Frame-Options', 'ALLOW-FROM https://admin.shopify.com');
  
  next();
};

/**
 * Validate shop parameter exists and is valid
 */
const validateShopParameter = (req, res, next) => {
  const shop = req.body?.shop || req.query?.shop || req.params?.shop;
  
  if (!shop) {
    return next(new ShopifyError('Shop parameter is required', 'SHOP_REQUIRED'));
  }

  // Basic validation - more thorough validation happens in the service
  if (!shop.includes('.myshopify.com')) {
    return next(new ShopifyError('Invalid shop format', 'INVALID_SHOP_FORMAT'));
  }

  next();
};

/**
 * Track failed authentication attempts
 */
const trackFailedAttempt = async (ip, shop) => {
  try {
    const failedAttemptsKey = `shopify:failed:ip:${ip}`;
    const currentAttempts = await redisClient.get(failedAttemptsKey);
    const newAttempts = currentAttempts ? parseInt(currentAttempts) + 1 : 1;
    
    // Set with 1 hour expiry
    await redisClient.setEx(failedAttemptsKey, 3600, newAttempts.toString());
    
    securityLogger.logAuthAttempt(false, {
      ip,
      shop,
      attemptNumber: newAttempts
    });
  } catch (error) {
    logger.error('Error tracking failed attempt', { error: error.message });
  }
};

/**
 * Clear failed attempts on successful auth
 */
const clearFailedAttempts = async (ip) => {
  try {
    const failedAttemptsKey = `shopify:failed:ip:${ip}`;
    await redisClient.del(failedAttemptsKey);
  } catch (error) {
    logger.error('Error clearing failed attempts', { error: error.message });
  }
};

module.exports = {
  oauthRateLimiter,
  suspiciousActivityMiddleware,
  auditLoggingMiddleware,
  shopifyCorsMiddleware,
  validateShopParameter,
  trackFailedAttempt,
  clearFailedAttempts
};