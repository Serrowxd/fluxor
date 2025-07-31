const db = require('../../config/database');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

class Store {
  static async create({ userId, storeName, shopifyDomain, accessToken }) {
    const storeId = uuidv4();
    const encryptedToken = this.encryptToken(accessToken);
    
    const result = await db.query(
      `INSERT INTO stores (store_id, user_id, store_name, shopify_domain, access_token) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING store_id, user_id, store_name, shopify_domain, created_at`,
      [storeId, userId, storeName, shopifyDomain, encryptedToken]
    );
    
    return result.rows[0];
  }

  static async findByUserId(userId) {
    const result = await db.query(
      `SELECT store_id, user_id, store_name, shopify_domain, created_at 
       FROM stores 
       WHERE user_id = $1`,
      [userId]
    );
    
    return result.rows;
  }

  static async findById(storeId) {
    const result = await db.query(
      'SELECT * FROM stores WHERE store_id = $1',
      [storeId]
    );
    
    if (result.rows[0]) {
      result.rows[0].access_token = this.decryptToken(result.rows[0].access_token);
    }
    
    return result.rows[0] || null;
  }

  static async findByDomain(shopifyDomain) {
    const result = await db.query(
      'SELECT * FROM stores WHERE shopify_domain = $1',
      [shopifyDomain]
    );
    
    return result.rows[0] || null;
  }

  static async updateAccessToken(storeId, newAccessToken) {
    const encryptedToken = this.encryptToken(newAccessToken);
    
    const result = await db.query(
      `UPDATE stores SET access_token = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE store_id = $2 
       RETURNING store_id, store_name`,
      [encryptedToken, storeId]
    );
    
    return result.rows[0];
  }

  static async delete(storeId) {
    const result = await db.query(
      'DELETE FROM stores WHERE store_id = $1 RETURNING store_id',
      [storeId]
    );
    
    return result.rows[0];
  }

  // Encryption helpers
  static encryptToken(token) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(process.env.JWT_SECRET, 'salt', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  static decryptToken(encryptedToken) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(process.env.JWT_SECRET, 'salt', 32);
    
    const parts = encryptedToken.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

module.exports = Store;