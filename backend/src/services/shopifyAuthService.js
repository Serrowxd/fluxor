const crypto = require('crypto');
const axios = require('axios');
const shopifyTokenModel = require('../models/shopifyTokenModel');
const { logger } = require('../utils/logger');
const { ShopifyError } = require('../utils/errors');

const SHOPIFY_API_VERSION = '2024-01';
const SHOPIFY_SCOPES = [
  'read_products',
  'write_products',
  'read_inventory',
  'write_inventory',
  'read_orders',
  'read_fulfillments',
  'write_fulfillments'
].join(',');

/**
 * Validates shop domain format
 */
const isValidShopDomain = (shop) => {
  const shopRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
  return shopRegex.test(shop);
};

/**
 * Generates Shopify OAuth authorization URL
 */
const generateAuthorizationUrl = ({ shop, state, codeChallenge }) => {
  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_CLIENT_ID,
    scope: SHOPIFY_SCOPES,
    redirect_uri: `${process.env.APP_URL}/api/v1/integrations/shopify/callback`,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
};

/**
 * Verifies HMAC signature from Shopify
 */
const verifyHmac = (query) => {
  const { hmac, ...params } = query;

  // Create query string in the exact format Shopify uses
  const queryString = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');

  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_CLIENT_SECRET)
    .update(queryString)
    .digest('hex');

  // Use constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(hash, 'utf-8'),
    Buffer.from(hmac, 'utf-8')
  );
};

/**
 * Exchanges authorization code for access token
 */
const exchangeCodeForToken = async ({ shop, code, codeVerifier }) => {
  try {
    const response = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      code,
      code_verifier: codeVerifier
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 seconds
    });

    if (!response.data.access_token) {
      throw new ShopifyError('No access token received from Shopify', 'TOKEN_EXCHANGE_FAILED');
    }

    return response.data;
  } catch (error) {
    if (error.response) {
      logger.error('Shopify token exchange failed', {
        status: error.response.status,
        data: error.response.data,
        shop
      });
      throw new ShopifyError(
        `Token exchange failed: ${error.response.data.error_description || error.response.data.error}`,
        'TOKEN_EXCHANGE_FAILED'
      );
    }
    throw error;
  }
};

/**
 * Stores encrypted access token in database
 */
const storeAccessToken = async ({ shop, accessToken, scope, userId }) => {
  try {
    // Generate encryption key and IV
    const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(16);

    // Encrypt the access token
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    let encryptedToken = cipher.update(accessToken, 'utf8', 'hex');
    encryptedToken += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    // Combine encrypted token with auth tag
    const encryptedData = encryptedToken + authTag.toString('hex');

    await shopifyTokenModel.upsertToken({
      shopDomain: shop,
      encryptedAccessToken: encryptedData,
      encryptionIv: iv.toString('hex'),
      scope,
      userId
    });

    logger.info('Shopify access token stored successfully', { shop, userId });
  } catch (error) {
    logger.error('Failed to store Shopify access token', {
      error: error.message,
      shop
    });
    throw new ShopifyError('Failed to store access token', 'TOKEN_STORAGE_FAILED');
  }
};

/**
 * Retrieves and decrypts access token
 */
const getAccessToken = async (shop) => {
  try {
    const tokenData = await shopifyTokenModel.getTokenByShop(shop);

    if (!tokenData) {
      throw new ShopifyError('No access token found for shop', 'TOKEN_NOT_FOUND');
    }

    // Decrypt the access token
    const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    const iv = Buffer.from(tokenData.encryption_iv, 'hex');
    
    // Extract auth tag (last 16 bytes)
    const encryptedData = tokenData.encrypted_access_token;
    const authTag = Buffer.from(encryptedData.slice(-32), 'hex');
    const encryptedToken = encryptedData.slice(0, -32);

    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decryptedToken = decipher.update(encryptedToken, 'hex', 'utf8');
    decryptedToken += decipher.final('utf8');

    return {
      accessToken: decryptedToken,
      scope: tokenData.scope,
      shopDomain: tokenData.shop_domain
    };
  } catch (error) {
    if (error.code === 'TOKEN_NOT_FOUND') {
      throw error;
    }
    logger.error('Failed to retrieve/decrypt access token', {
      error: error.message,
      shop
    });
    throw new ShopifyError('Failed to retrieve access token', 'TOKEN_RETRIEVAL_FAILED');
  }
};

/**
 * Validates access token is still valid
 */
const validateToken = async (shop) => {
  try {
    const { accessToken } = await getAccessToken(shop);

    // Make a simple API call to verify token is still valid
    const response = await axios.get(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken
      },
      timeout: 10000
    });

    return response.status === 200;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      return false;
    }
    throw error;
  }
};

/**
 * Revokes access token
 */
const revokeToken = async (shop, userId) => {
  try {
    await shopifyTokenModel.deleteToken(shop, userId);
    logger.info('Shopify token revoked', { shop, userId });
  } catch (error) {
    logger.error('Failed to revoke token', {
      error: error.message,
      shop,
      userId
    });
    throw new ShopifyError('Failed to revoke token', 'TOKEN_REVOCATION_FAILED');
  }
};

/**
 * Refreshes access token if needed (for future use with online tokens)
 */
const refreshTokenIfNeeded = async (shop) => {
  // For now, Shopify offline tokens don't expire
  // This is a placeholder for future online token support
  return getAccessToken(shop);
};

module.exports = {
  isValidShopDomain,
  generateAuthorizationUrl,
  verifyHmac,
  exchangeCodeForToken,
  storeAccessToken,
  getAccessToken,
  validateToken,
  revokeToken,
  refreshTokenIfNeeded
};