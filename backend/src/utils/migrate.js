const db = require('../../config/database');

const createTables = async () => {
  try {
    console.log('Starting database migration...');

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
    console.log('Created users table');

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
    console.log('Created stores table');

    // Create products table
    await db.query(`
      CREATE TABLE IF NOT EXISTS products (
        product_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID REFERENCES stores(store_id) ON DELETE CASCADE,
        shopify_product_id VARCHAR(255) NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        sku VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(store_id, shopify_product_id)
      )
    `);
    console.log('Created products table');

    // Create inventory table
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        inventory_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        current_stock INTEGER NOT NULL DEFAULT 0,
        last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Created inventory table');

    // Create sales table
    await db.query(`
      CREATE TABLE IF NOT EXISTS sales (
        sale_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        quantity_sold INTEGER NOT NULL,
        sale_date TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Created sales table');

    // Create forecasts table
    await db.query(`
      CREATE TABLE IF NOT EXISTS forecasts (
        forecast_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        forecast_date DATE NOT NULL,
        predicted_demand FLOAT NOT NULL,
        confidence_level VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, forecast_date)
      )
    `);
    console.log('Created forecasts table');

    // Create alerts table
    await db.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        alert_type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_alert_for_product TIMESTAMP
      )
    `);
    console.log('Created alerts table');

    // Create user_settings table
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        setting_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(user_id) ON DELETE CASCADE UNIQUE,
        low_stock_threshold INTEGER DEFAULT 10,
        alert_email_enabled BOOLEAN DEFAULT true,
        time_zone VARCHAR(50) DEFAULT 'UTC',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Created user_settings table');

    // Create indexes for performance
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date);
      CREATE INDEX IF NOT EXISTS idx_inventory_last_updated ON inventory(last_updated);
      CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);
      CREATE INDEX IF NOT EXISTS idx_forecasts_product_date ON forecasts(product_id, forecast_date);
    `);
    console.log('Created indexes');

    console.log('Database migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

createTables();