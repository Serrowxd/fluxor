const db = require("../../config/database");

module.exports = {
  up: async () => {
    console.log("Running migration 003_multi_channel_system...");

    // Create channels table
    await db.query(`
      CREATE TABLE IF NOT EXISTS channels (
        channel_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel_name VARCHAR(100) NOT NULL UNIQUE,
        channel_type VARCHAR(50) NOT NULL,
        api_endpoint VARCHAR(500),
        is_active BOOLEAN DEFAULT TRUE,
        rate_limit_per_minute INTEGER DEFAULT 60,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create channel_credentials table for storing encrypted API credentials
    await db.query(`
      CREATE TABLE IF NOT EXISTS channel_credentials (
        credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID REFERENCES stores(store_id) ON DELETE CASCADE,
        channel_id UUID REFERENCES channels(channel_id) ON DELETE CASCADE,
        credentials_encrypted TEXT NOT NULL,
        is_valid BOOLEAN DEFAULT TRUE,
        last_validated TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(store_id, channel_id)
      )
    `);

    // Create channel_products table for cross-channel product mapping
    await db.query(`
      CREATE TABLE IF NOT EXISTS channel_products (
        channel_product_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        channel_id UUID REFERENCES channels(channel_id) ON DELETE CASCADE,
        external_product_id VARCHAR(255) NOT NULL,
        external_sku VARCHAR(255),
        channel_price DECIMAL(10,2),
        is_active BOOLEAN DEFAULT TRUE,
        sync_inventory BOOLEAN DEFAULT TRUE,
        last_synced TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, channel_id)
      )
    `);

    // Create inventory_allocation table for multi-channel inventory distribution
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory_allocation (
        allocation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        channel_id UUID REFERENCES channels(channel_id) ON DELETE CASCADE,
        allocated_quantity INTEGER NOT NULL DEFAULT 0,
        allocation_strategy VARCHAR(50) DEFAULT 'proportional',
        priority_level INTEGER DEFAULT 1,
        min_allocation INTEGER DEFAULT 0,
        max_allocation INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, channel_id)
      )
    `);

    console.log("Migration 003_multi_channel_system completed");
  },

  down: async () => {
    console.log("Rolling back migration 003_multi_channel_system...");
    
    await db.query("DROP TABLE IF EXISTS inventory_allocation CASCADE");
    await db.query("DROP TABLE IF EXISTS channel_products CASCADE");
    await db.query("DROP TABLE IF EXISTS channel_credentials CASCADE");
    await db.query("DROP TABLE IF EXISTS channels CASCADE");
    
    console.log("Rollback 003_multi_channel_system completed");
  }
};