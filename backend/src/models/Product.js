const db = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

class Product {
  static async create({ storeId, shopifyProductId, productName, sku }) {
    const productId = uuidv4();
    
    const result = await db.query(
      `INSERT INTO products (product_id, store_id, shopify_product_id, product_name, sku) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (store_id, shopify_product_id) 
       DO UPDATE SET product_name = $4, sku = $5, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [productId, storeId, shopifyProductId, productName, sku]
    );
    
    return result.rows[0];
  }

  static async findByStoreId(storeId) {
    const result = await db.query(
      `SELECT p.*, i.current_stock, i.last_updated as stock_updated_at
       FROM products p
       LEFT JOIN inventory i ON p.product_id = i.product_id
       WHERE p.store_id = $1
       ORDER BY p.product_name`,
      [storeId]
    );
    
    return result.rows;
  }

  static async findById(productId) {
    const result = await db.query(
      `SELECT p.*, i.current_stock, i.last_updated as stock_updated_at
       FROM products p
       LEFT JOIN inventory i ON p.product_id = i.product_id
       WHERE p.product_id = $1`,
      [productId]
    );
    
    return result.rows[0] || null;
  }

  static async findByShopifyId(storeId, shopifyProductId) {
    const result = await db.query(
      `SELECT * FROM products 
       WHERE store_id = $1 AND shopify_product_id = $2`,
      [storeId, shopifyProductId]
    );
    
    return result.rows[0] || null;
  }

  static async updateStock(productId, currentStock) {
    // First, check if inventory record exists
    const existing = await db.query(
      'SELECT inventory_id FROM inventory WHERE product_id = $1',
      [productId]
    );

    if (existing.rows.length > 0) {
      // Update existing inventory
      const result = await db.query(
        `UPDATE inventory 
         SET current_stock = $1, last_updated = CURRENT_TIMESTAMP 
         WHERE product_id = $2 
         RETURNING *`,
        [currentStock, productId]
      );
      return result.rows[0];
    } else {
      // Create new inventory record
      const inventoryId = uuidv4();
      const result = await db.query(
        `INSERT INTO inventory (inventory_id, product_id, current_stock) 
         VALUES ($1, $2, $3) 
         RETURNING *`,
        [inventoryId, productId, currentStock]
      );
      return result.rows[0];
    }
  }

  static async getLowStockProducts(storeId, threshold) {
    const result = await db.query(
      `SELECT p.*, i.current_stock, i.last_updated as stock_updated_at
       FROM products p
       JOIN inventory i ON p.product_id = i.product_id
       WHERE p.store_id = $1 AND i.current_stock <= $2
       ORDER BY i.current_stock ASC`,
      [storeId, threshold]
    );
    
    return result.rows;
  }

  static async delete(productId) {
    const result = await db.query(
      'DELETE FROM products WHERE product_id = $1 RETURNING product_id',
      [productId]
    );
    
    return result.rows[0];
  }
}

module.exports = Product;