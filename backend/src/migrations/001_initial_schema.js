const db = require("../../config/database");

module.exports = {
  up: async () => {
    console.log("Running migration 001_initial_schema...");

    // Create users table
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create stores table
    await db.query(`
      CREATE TABLE IF NOT EXISTS stores (
        store_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
        store_name VARCHAR(255) NOT NULL,
        shopify_domain VARCHAR(255) NOT NULL,
        access_token VARCHAR(500) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create products table
    await db.query(`
      CREATE TABLE IF NOT EXISTS products (
        product_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID REFERENCES stores(store_id) ON DELETE CASCADE,
        shopify_product_id VARCHAR(255) NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        sku VARCHAR(255),
        unit_cost DECIMAL(10,2) DEFAULT 0,
        selling_price DECIMAL(10,2) DEFAULT 0,
        category VARCHAR(100),
        supplier_id UUID,
        supplier_lead_time INTEGER DEFAULT 7,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(store_id, shopify_product_id)
      )
    `);

    // Create inventory table
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        inventory_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        quantity_available INTEGER NOT NULL DEFAULT 0,
        quantity_reserved INTEGER DEFAULT 0,
        quantity_on_hand INTEGER DEFAULT 0,
        reorder_point INTEGER DEFAULT 10,
        max_stock_level INTEGER DEFAULT 100,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        location VARCHAR(100) DEFAULT 'main',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("Migration 001_initial_schema completed");
  },

  down: async () => {
    console.log("Rolling back migration 001_initial_schema...");
    
    await db.query("DROP TABLE IF EXISTS inventory CASCADE");
    await db.query("DROP TABLE IF EXISTS products CASCADE");
    await db.query("DROP TABLE IF EXISTS stores CASCADE");
    await db.query("DROP TABLE IF EXISTS users CASCADE");
    
    console.log("Rollback 001_initial_schema completed");
  }
};