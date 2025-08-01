const db = require("../../config/database");

module.exports = {
  up: async () => {
    console.log("Running migration 002_sales_and_forecasting...");

    // Create sales table
    await db.query(`
      CREATE TABLE IF NOT EXISTS sales (
        sale_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        quantity_sold INTEGER NOT NULL,
        sale_price DECIMAL(10,2) NOT NULL,
        sale_date TIMESTAMP NOT NULL,
        channel VARCHAR(100) DEFAULT 'shopify',
        order_id VARCHAR(255),
        customer_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create forecast table
    await db.query(`
      CREATE TABLE IF NOT EXISTS forecast (
        forecast_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        forecast_period VARCHAR(20) NOT NULL,
        forecast_date DATE NOT NULL,
        predicted_demand INTEGER NOT NULL,
        confidence_level DECIMAL(5,2) DEFAULT 0.80,
        model_used VARCHAR(50) DEFAULT 'prophet',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create alerts table
    await db.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID REFERENCES stores(store_id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        alert_type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        severity VARCHAR(20) DEFAULT 'medium',
        is_resolved BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP
      )
    `);

    // Create settings table
    await db.query(`
      CREATE TABLE IF NOT EXISTS settings (
        setting_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID REFERENCES stores(store_id) ON DELETE CASCADE,
        setting_key VARCHAR(100) NOT NULL,
        setting_value TEXT,
        data_type VARCHAR(20) DEFAULT 'string',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(store_id, setting_key)
      )
    `);

    console.log("Migration 002_sales_and_forecasting completed");
  },

  down: async () => {
    console.log("Rolling back migration 002_sales_and_forecasting...");
    
    await db.query("DROP TABLE IF EXISTS settings CASCADE");
    await db.query("DROP TABLE IF EXISTS alerts CASCADE");
    await db.query("DROP TABLE IF EXISTS forecast CASCADE");
    await db.query("DROP TABLE IF EXISTS sales CASCADE");
    
    console.log("Rollback 002_sales_and_forecasting completed");
  }
};