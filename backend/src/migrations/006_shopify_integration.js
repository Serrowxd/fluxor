const migration = {
  up: async (pool) => {
    console.log('Running migration: 006_shopify_integration');

    // Create shopify_tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shopify_tokens (
        id SERIAL PRIMARY KEY,
        shop_domain VARCHAR(255) UNIQUE NOT NULL,
        encrypted_access_token TEXT NOT NULL,
        encryption_iv VARCHAR(32) NOT NULL,
        scope TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_rotated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes
    await pool.query(`
      CREATE INDEX idx_shopify_tokens_shop_domain ON shopify_tokens(shop_domain);
    `);

    await pool.query(`
      CREATE INDEX idx_shopify_tokens_user_id ON shopify_tokens(user_id);
    `);

    await pool.query(`
      CREATE INDEX idx_shopify_tokens_last_rotated ON shopify_tokens(last_rotated_at);
    `);

    // Create shopify_auth_attempts table for security auditing
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shopify_auth_attempts (
        id SERIAL PRIMARY KEY,
        shop_domain VARCHAR(255),
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ip_address INET,
        user_agent TEXT,
        success BOOLEAN NOT NULL,
        failure_reason VARCHAR(255),
        state_parameter VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create index for auth attempts
    await pool.query(`
      CREATE INDEX idx_shopify_auth_attempts_ip ON shopify_auth_attempts(ip_address);
    `);

    await pool.query(`
      CREATE INDEX idx_shopify_auth_attempts_created ON shopify_auth_attempts(created_at);
    `);

    // Create shopify_webhooks table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shopify_webhooks (
        id SERIAL PRIMARY KEY,
        shop_domain VARCHAR(255) NOT NULL REFERENCES shopify_tokens(shop_domain) ON DELETE CASCADE,
        webhook_id VARCHAR(255) NOT NULL,
        topic VARCHAR(100) NOT NULL,
        address TEXT NOT NULL,
        api_version VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(shop_domain, topic)
      );
    `);

    // Create shopify_products_mapping table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shopify_products_mapping (
        id SERIAL PRIMARY KEY,
        shop_domain VARCHAR(255) NOT NULL REFERENCES shopify_tokens(shop_domain) ON DELETE CASCADE,
        shopify_product_id VARCHAR(255) NOT NULL,
        shopify_variant_id VARCHAR(255),
        fluxor_product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        sku VARCHAR(255),
        last_synced_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(shop_domain, shopify_variant_id)
      );
    `);

    // Create indexes for product mapping
    await pool.query(`
      CREATE INDEX idx_shopify_products_mapping_shop ON shopify_products_mapping(shop_domain);
    `);

    await pool.query(`
      CREATE INDEX idx_shopify_products_mapping_sku ON shopify_products_mapping(sku);
    `);

    // Create shopify_sync_history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shopify_sync_history (
        id SERIAL PRIMARY KEY,
        shop_domain VARCHAR(255) NOT NULL REFERENCES shopify_tokens(shop_domain) ON DELETE CASCADE,
        sync_type VARCHAR(50) NOT NULL, -- 'full', 'incremental', 'webhook'
        entity_type VARCHAR(50) NOT NULL, -- 'products', 'orders', 'inventory'
        status VARCHAR(20) NOT NULL, -- 'started', 'completed', 'failed'
        total_items INTEGER,
        processed_items INTEGER,
        failed_items INTEGER,
        error_details JSONB,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create index for sync history
    await pool.query(`
      CREATE INDEX idx_shopify_sync_history_shop_status ON shopify_sync_history(shop_domain, status);
    `);

    console.log('Migration 006_shopify_integration completed successfully');
  },

  down: async (pool) => {
    console.log('Rolling back migration: 006_shopify_integration');

    // Drop tables in reverse order of dependencies
    await pool.query('DROP TABLE IF EXISTS shopify_sync_history CASCADE;');
    await pool.query('DROP TABLE IF EXISTS shopify_products_mapping CASCADE;');
    await pool.query('DROP TABLE IF EXISTS shopify_webhooks CASCADE;');
    await pool.query('DROP TABLE IF EXISTS shopify_auth_attempts CASCADE;');
    await pool.query('DROP TABLE IF EXISTS shopify_tokens CASCADE;');

    console.log('Rollback of 006_shopify_integration completed');
  }
};

module.exports = migration;