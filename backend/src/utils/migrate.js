const db = require("../../config/database");

const createTables = async () => {
  try {
    console.log("Starting database migration...");

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
    console.log("Created users table");

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
    console.log("Created stores table");

    // Enhanced products table with cost and pricing information
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
    console.log("Created products table");

    // Enhanced inventory table with reorder points and carrying costs
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        inventory_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        current_stock INTEGER NOT NULL DEFAULT 0,
        reserved_stock INTEGER DEFAULT 0,
        reorder_point INTEGER DEFAULT 10,
        max_stock_level INTEGER DEFAULT 100,
        storage_cost_per_unit DECIMAL(8,4) DEFAULT 0,
        insurance_rate DECIMAL(5,4) DEFAULT 0.02,
        last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created inventory table");

    // Enhanced sales table with unit price and revenue tracking
    await db.query(`
      CREATE TABLE IF NOT EXISTS sales (
        sale_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        quantity_sold INTEGER NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
        total_revenue DECIMAL(12,2) GENERATED ALWAYS AS (quantity_sold * unit_price) STORED,
        sale_date TIMESTAMP NOT NULL,
        channel VARCHAR(50) DEFAULT 'shopify',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created sales table");

    // Enhanced forecasts table
    await db.query(`
      CREATE TABLE IF NOT EXISTS forecasts (
        forecast_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        forecast_date DATE NOT NULL,
        predicted_demand FLOAT NOT NULL,
        confidence_score FLOAT DEFAULT 0.5,
        confidence_level VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, forecast_date)
      )
    `);
    console.log("Created forecasts table");

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
    console.log("Created alerts table");

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
    console.log("Created user_settings table");

    // Create Product Cost History table for tracking cost changes
    await db.query(`
      CREATE TABLE IF NOT EXISTS product_cost_history (
        cost_history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        unit_cost DECIMAL(10,2) NOT NULL,
        effective_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        cost_type VARCHAR(50) DEFAULT 'standard',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created product_cost_history table");

    // Create Stockout Events table for tracking stockout occurrences
    await db.query(`
      CREATE TABLE IF NOT EXISTS stockout_events (
        stockout_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        stockout_date TIMESTAMP NOT NULL,
        duration_hours INTEGER,
        lost_sales_estimate INTEGER DEFAULT 0,
        lost_revenue_estimate DECIMAL(12,2) DEFAULT 0,
        resolved_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created stockout_events table");

    // Create Analytics Cache table for storing calculated metrics
    await db.query(`
      CREATE TABLE IF NOT EXISTS analytics_cache (
        cache_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cache_key VARCHAR(255) UNIQUE NOT NULL,
        cache_data JSONB NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created analytics_cache table");

    // Create enhanced indexes for performance optimization
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date);
      CREATE INDEX IF NOT EXISTS idx_sales_product_date ON sales(product_id, sale_date);
      CREATE INDEX IF NOT EXISTS idx_sales_date_desc ON sales(sale_date DESC);
      CREATE INDEX IF NOT EXISTS idx_inventory_last_updated ON inventory(last_updated);
      CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);
      CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);
      CREATE INDEX IF NOT EXISTS idx_forecasts_product_date ON forecasts(product_id, forecast_date);
      CREATE INDEX IF NOT EXISTS idx_stockout_events_product_date ON stockout_events(product_id, stockout_date);
      CREATE INDEX IF NOT EXISTS idx_analytics_cache_key ON analytics_cache(cache_key);
      CREATE INDEX IF NOT EXISTS idx_analytics_cache_expires ON analytics_cache(expires_at);
      CREATE INDEX IF NOT EXISTS idx_product_cost_history_product_date ON product_cost_history(product_id, effective_date DESC);
    `);
    console.log("Created enhanced indexes");

    // Create materialized view for real-time inventory metrics
    await db.query(`
      DROP MATERIALIZED VIEW IF EXISTS inventory_metrics_view;
      CREATE MATERIALIZED VIEW inventory_metrics_view AS
      SELECT 
        p.product_id,
        p.product_name,
        p.sku,
        p.unit_cost,
        p.selling_price,
        p.category,
        i.current_stock,
        i.reserved_stock,
        i.reorder_point,
        i.max_stock_level,
        i.storage_cost_per_unit,
        i.insurance_rate,
        COALESCE(sales_30d.total_sold, 0) as sales_last_30_days,
        COALESCE(sales_30d.total_revenue, 0) as revenue_last_30_days,
        COALESCE(sales_30d.avg_daily_sales, 0) as avg_daily_sales,
        CASE 
          WHEN COALESCE(sales_30d.avg_daily_sales, 0) > 0 
          THEN i.current_stock / sales_30d.avg_daily_sales 
          ELSE NULL 
        END as days_of_supply,
        CASE
          WHEN i.current_stock = 0 THEN 'stockout'
          WHEN i.current_stock <= i.reorder_point THEN 'critical'
          WHEN i.current_stock <= (i.reorder_point * 1.5) THEN 'low'
          WHEN i.current_stock >= i.max_stock_level THEN 'overstock'
          ELSE 'normal'
        END as stock_status,
        CASE 
          WHEN p.selling_price > 0 AND p.unit_cost > 0 
          THEN ((p.selling_price - p.unit_cost) / p.selling_price) * 100 
          ELSE 0 
        END as gross_margin_percent,
        i.last_updated
      FROM products p
      LEFT JOIN inventory i ON p.product_id = i.product_id
      LEFT JOIN (
        SELECT 
          product_id,
          SUM(quantity_sold) as total_sold,
          SUM(total_revenue) as total_revenue,
          AVG(daily_sales) as avg_daily_sales
        FROM (
          SELECT 
            product_id,
            DATE(sale_date) as sale_day,
            SUM(quantity_sold) as daily_sales,
            SUM(total_revenue) as daily_revenue
          FROM sales 
          WHERE sale_date >= NOW() - INTERVAL '30 days'
          GROUP BY product_id, DATE(sale_date)
        ) daily_summary
        GROUP BY product_id
      ) sales_30d ON p.product_id = sales_30d.product_id;
    `);
    console.log("Created inventory_metrics_view materialized view");

    // Create function to refresh materialized view
    await db.query(`
      CREATE OR REPLACE FUNCTION refresh_inventory_metrics()
      RETURNS void AS $$
      BEGIN
        REFRESH MATERIALIZED VIEW inventory_metrics_view;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log("Created refresh_inventory_metrics function");

    console.log("Database migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
};

createTables();
