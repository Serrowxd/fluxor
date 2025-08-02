const pool = require('../../config/database');
const { logger } = require('../utils/logger');

/**
 * Creates or updates a Shopify token
 */
const upsertToken = async ({ shopDomain, encryptedAccessToken, encryptionIv, scope, userId }) => {
  const query = `
    INSERT INTO shopify_tokens (shop_domain, encrypted_access_token, encryption_iv, scope, user_id)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (shop_domain)
    DO UPDATE SET
      encrypted_access_token = $2,
      encryption_iv = $3,
      scope = $4,
      user_id = $5,
      updated_at = CURRENT_TIMESTAMP,
      last_rotated_at = CURRENT_TIMESTAMP
    RETURNING id, shop_domain, created_at, updated_at`;

  try {
    const result = await pool.query(query, [
      shopDomain,
      encryptedAccessToken,
      encryptionIv,
      scope,
      userId
    ]);
    
    return result.rows[0];
  } catch (error) {
    logger.error('Failed to upsert Shopify token', {
      error: error.message,
      shopDomain
    });
    throw error;
  }
};

/**
 * Retrieves a token by shop domain
 */
const getTokenByShop = async (shopDomain) => {
  const query = `
    SELECT 
      id,
      shop_domain,
      encrypted_access_token,
      encryption_iv,
      scope,
      user_id,
      created_at,
      updated_at,
      last_rotated_at
    FROM shopify_tokens
    WHERE shop_domain = $1`;

  try {
    const result = await pool.query(query, [shopDomain]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Failed to retrieve Shopify token', {
      error: error.message,
      shopDomain
    });
    throw error;
  }
};

/**
 * Retrieves all tokens for a user
 */
const getTokensByUser = async (userId) => {
  const query = `
    SELECT 
      id,
      shop_domain,
      scope,
      created_at,
      updated_at,
      last_rotated_at
    FROM shopify_tokens
    WHERE user_id = $1
    ORDER BY created_at DESC`;

  try {
    const result = await pool.query(query, [userId]);
    return result.rows;
  } catch (error) {
    logger.error('Failed to retrieve user tokens', {
      error: error.message,
      userId
    });
    throw error;
  }
};

/**
 * Deletes a token
 */
const deleteToken = async (shopDomain, userId) => {
  const query = `
    DELETE FROM shopify_tokens
    WHERE shop_domain = $1 AND user_id = $2
    RETURNING id`;

  try {
    const result = await pool.query(query, [shopDomain, userId]);
    return result.rows[0];
  } catch (error) {
    logger.error('Failed to delete Shopify token', {
      error: error.message,
      shopDomain,
      userId
    });
    throw error;
  }
};

/**
 * Updates token rotation timestamp
 */
const updateTokenRotation = async (shopDomain) => {
  const query = `
    UPDATE shopify_tokens
    SET last_rotated_at = CURRENT_TIMESTAMP
    WHERE shop_domain = $1
    RETURNING last_rotated_at`;

  try {
    const result = await pool.query(query, [shopDomain]);
    return result.rows[0];
  } catch (error) {
    logger.error('Failed to update token rotation', {
      error: error.message,
      shopDomain
    });
    throw error;
  }
};

/**
 * Gets tokens that need rotation (older than 30 days)
 */
const getTokensForRotation = async () => {
  const query = `
    SELECT 
      shop_domain,
      user_id,
      last_rotated_at
    FROM shopify_tokens
    WHERE last_rotated_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
    ORDER BY last_rotated_at ASC
    LIMIT 100`;

  try {
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    logger.error('Failed to get tokens for rotation', {
      error: error.message
    });
    throw error;
  }
};

/**
 * Counts total active tokens
 */
const countActiveTokens = async () => {
  const query = `SELECT COUNT(*) as count FROM shopify_tokens`;

  try {
    const result = await pool.query(query);
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    logger.error('Failed to count active tokens', {
      error: error.message
    });
    throw error;
  }
};

module.exports = {
  upsertToken,
  getTokenByShop,
  getTokensByUser,
  deleteToken,
  updateTokenRotation,
  getTokensForRotation,
  countActiveTokens
};