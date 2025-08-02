const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const shopifyController = require('../controllers/shopifyController');
const { validateShopifyAuth } = require('../middleware/validation');
const {
  oauthRateLimiter,
  suspiciousActivityMiddleware,
  auditLoggingMiddleware,
  shopifyCorsMiddleware,
  validateShopParameter
} = require('../middleware/shopifyAuthMiddleware');

// Apply CORS for all Shopify routes
router.use('/shopify', shopifyCorsMiddleware);

// Apply audit logging for all Shopify auth routes
router.use('/shopify/auth', auditLoggingMiddleware);
router.use('/shopify/callback', auditLoggingMiddleware);

// Shopify OAuth routes
router.post(
  '/shopify/auth',
  authenticateToken,
  oauthRateLimiter,
  suspiciousActivityMiddleware,
  validateShopifyAuth,
  shopifyController.initiateOAuth
);

router.get(
  '/shopify/callback',
  suspiciousActivityMiddleware,
  validateShopParameter,
  shopifyController.handleOAuthCallback
);

// Shopify token management
router.delete(
  '/shopify/auth',
  authenticateToken,
  validateShopParameter,
  shopifyController.revokeAccess
);

module.exports = router;