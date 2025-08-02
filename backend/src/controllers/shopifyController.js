const crypto = require('crypto');
const { promisify } = require('util');
const { redisClient } = require('../../config/redis');
const shopifyAuthService = require('../services/shopifyAuthService');
const { logger } = require('../utils/logger');
const { ShopifyError } = require('../utils/errors');

/**
 * Initiates OAuth flow for Shopify app installation
 * Implements PKCE flow with state parameter for security
 */
const initiateOAuth = async (req, res, next) => {
  try {
    const { shop } = req.body;
    const userId = req.user.id;

    // Validate shop domain format
    if (!shopifyAuthService.isValidShopDomain(shop)) {
      throw new ShopifyError('Invalid shop domain format. Must end with .myshopify.com', 'INVALID_SHOP_DOMAIN');
    }

    // Generate cryptographically secure state and code verifier
    const stateBuffer = crypto.randomBytes(32);
    const codeVerifierBuffer = crypto.randomBytes(32);

    const state = stateBuffer.toString('base64url');
    const codeVerifier = codeVerifierBuffer.toString('base64url');

    // Generate code challenge for PKCE
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // Store state and code verifier in Redis with 10-minute TTL
    const redisKey = `shopify:oauth:${state}`;
    const redisData = JSON.stringify({
      shop,
      userId,
      codeVerifier,
      timestamp: Date.now()
    });

    await redisClient.setEx(redisKey, 600, redisData); // 10 minutes TTL

    // Generate authorization URL
    const authUrl = shopifyAuthService.generateAuthorizationUrl({
      shop,
      state,
      codeChallenge
    });

    // Log OAuth initiation
    logger.info('Shopify OAuth initiated', {
      shop,
      userId,
      state: state.substring(0, 10) + '...' // Log partial state for debugging
    });

    res.json({
      authorizationUrl: authUrl,
      shop
    });
  } catch (error) {
    logger.error('Shopify OAuth initiation failed', {
      error: error.message,
      shop: req.body.shop,
      userId: req.user?.id
    });
    next(error);
  }
};

/**
 * Handles OAuth callback from Shopify
 * Validates state, HMAC, and exchanges code for access token
 */
const handleOAuthCallback = async (req, res, next) => {
  try {
    const { code, state, shop, hmac, ...params } = req.query;

    // Validate required parameters
    if (!code || !state || !shop || !hmac) {
      throw new ShopifyError('Missing required OAuth parameters', 'OAUTH_PARAMS_MISSING');
    }

    // Verify HMAC signature
    if (!shopifyAuthService.verifyHmac(req.query)) {
      throw new ShopifyError('Invalid HMAC signature', 'INVALID_HMAC');
    }

    // Retrieve and validate state from Redis
    const redisKey = `shopify:oauth:${state}`;
    const storedData = await redisClient.get(redisKey);

    if (!storedData) {
      throw new ShopifyError('Invalid or expired state parameter', 'INVALID_STATE');
    }

    const { shop: storedShop, userId, codeVerifier, timestamp } = JSON.parse(storedData);

    // Validate shop matches
    if (shop !== storedShop) {
      throw new ShopifyError('Shop mismatch in OAuth callback', 'SHOP_MISMATCH');
    }

    // Delete state from Redis after validation
    await redisClient.del(redisKey);

    // Exchange authorization code for access token
    const tokenData = await shopifyAuthService.exchangeCodeForToken({
      shop,
      code,
      codeVerifier
    });

    // Store encrypted token
    await shopifyAuthService.storeAccessToken({
      shop,
      accessToken: tokenData.access_token,
      scope: tokenData.scope,
      userId
    });

    // Log successful OAuth completion
    logger.info('Shopify OAuth completed successfully', {
      shop,
      userId,
      scope: tokenData.scope
    });

    // Redirect to success page or return success response
    res.redirect(`${process.env.FRONTEND_URL}/integrations/shopify/success?shop=${encodeURIComponent(shop)}`);
  } catch (error) {
    logger.error('Shopify OAuth callback failed', {
      error: error.message,
      shop: req.query?.shop
    });

    // Redirect to error page with error details
    const errorUrl = `${process.env.FRONTEND_URL}/integrations/shopify/error?error=${encodeURIComponent(error.message)}`;
    res.redirect(errorUrl);
  }
};

/**
 * Revokes Shopify access token
 */
const revokeAccess = async (req, res, next) => {
  try {
    const { shop } = req.body;
    const userId = req.user.id;

    await shopifyAuthService.revokeToken(shop, userId);

    logger.info('Shopify access revoked', { shop, userId });

    res.json({
      success: true,
      message: 'Shopify access revoked successfully'
    });
  } catch (error) {
    logger.error('Failed to revoke Shopify access', {
      error: error.message,
      shop: req.body?.shop,
      userId: req.user?.id
    });
    next(error);
  }
};

module.exports = {
  initiateOAuth,
  handleOAuthCallback,
  revokeAccess
};