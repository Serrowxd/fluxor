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
        model_used VARCHAR(50) DEFAULT 'prophet',
        upper_bound FLOAT,
        lower_bound FLOAT,
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

    // Create forecast_accuracy table for tracking prediction performance
    await db.query(`
      CREATE TABLE IF NOT EXISTS forecast_accuracy (
        accuracy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        forecast_date DATE NOT NULL,
        predicted_demand FLOAT NOT NULL,
        actual_demand FLOAT NOT NULL,
        accuracy_percentage FLOAT GENERATED ALWAYS AS (
          CASE 
            WHEN predicted_demand = 0 AND actual_demand = 0 THEN 100.0
            WHEN predicted_demand = 0 THEN 0.0
            ELSE 100.0 - (ABS(predicted_demand - actual_demand) / predicted_demand * 100.0)
          END
        ) STORED,
        absolute_error FLOAT GENERATED ALWAYS AS (ABS(predicted_demand - actual_demand)) STORED,
        percentage_error FLOAT GENERATED ALWAYS AS (
          CASE 
            WHEN actual_demand = 0 THEN 
              CASE WHEN predicted_demand = 0 THEN 0.0 ELSE 100.0 END
            ELSE (predicted_demand - actual_demand) / actual_demand * 100.0
          END
        ) STORED,
        model_used VARCHAR(50) DEFAULT 'prophet',
        confidence_level VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, forecast_date)
      )
    `);
    console.log("Created forecast_accuracy table");

    // Create dead_stock_analysis table for tracking slow-moving inventory
    await db.query(`
      CREATE TABLE IF NOT EXISTS dead_stock_analysis (
        analysis_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        analysis_date DATE NOT NULL DEFAULT CURRENT_DATE,
        days_without_sale INTEGER NOT NULL,
        current_stock_value DECIMAL(12,2) NOT NULL,
        velocity_score FLOAT DEFAULT 0,
        dead_stock_classification VARCHAR(50) CHECK (dead_stock_classification IN ('slow_moving', 'dead_stock', 'obsolete')),
        liquidation_priority INTEGER DEFAULT 0,
        suggested_discount_percentage FLOAT DEFAULT 0,
        estimated_recovery_value DECIMAL(12,2) DEFAULT 0,
        clearance_recommendation TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created dead_stock_analysis table");

    // Create forecast_accuracy_metrics table for aggregated model performance
    await db.query(`
      CREATE TABLE IF NOT EXISTS forecast_accuracy_metrics (
        metric_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        category VARCHAR(100),
        time_period VARCHAR(50) NOT NULL, -- 'daily', 'weekly', 'monthly'
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        total_forecasts INTEGER DEFAULT 0,
        mean_absolute_error FLOAT DEFAULT 0,
        mean_absolute_percentage_error FLOAT DEFAULT 0,
        root_mean_square_error FLOAT DEFAULT 0,
        forecast_bias FLOAT DEFAULT 0,
        accuracy_percentage FLOAT DEFAULT 0,
        model_used VARCHAR(50) DEFAULT 'prophet',
        data_quality_score FLOAT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, time_period, period_start, period_end)
      )
    `);
    console.log("Created forecast_accuracy_metrics table");

    // Create external_factors table for enhanced forecasting
    await db.query(`
      CREATE TABLE IF NOT EXISTS external_factors (
        factor_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        factor_type VARCHAR(50) NOT NULL, -- 'holiday', 'event', 'promotion', 'weather'
        factor_name VARCHAR(255) NOT NULL,
        factor_date DATE NOT NULL,
        impact_coefficient FLOAT DEFAULT 1.0,
        category_affected VARCHAR(100),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        store_id UUID REFERENCES stores(store_id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created external_factors table");

    // === MULTI-CHANNEL SUPPORT TABLES (Ticket #3) ===

    // Create channels table for managing different sales channels
    await db.query(`
      CREATE TABLE IF NOT EXISTS channels (
        channel_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel_type VARCHAR(50) NOT NULL, -- 'shopify', 'amazon', 'ebay', 'square', 'custom'
        channel_name VARCHAR(255) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        sync_enabled BOOLEAN DEFAULT true,
        rate_limit_per_minute INTEGER DEFAULT 60,
        retry_attempts INTEGER DEFAULT 3,
        webhook_secret VARCHAR(255),
        configuration JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created channels table");

    // Create channel_credentials table for storing encrypted API credentials
    await db.query(`
      CREATE TABLE IF NOT EXISTS channel_credentials (
        credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID REFERENCES stores(store_id) ON DELETE CASCADE,
        channel_id UUID REFERENCES channels(channel_id) ON DELETE CASCADE,
        credentials_encrypted TEXT NOT NULL, -- JSON encrypted credentials
        expires_at TIMESTAMP,
        last_refreshed TIMESTAMP,
        is_valid BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(store_id, channel_id)
      )
    `);
    console.log("Created channel_credentials table");

    // Create channel_products table for mapping products across channels
    await db.query(`
      CREATE TABLE IF NOT EXISTS channel_products (
        channel_product_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        channel_id UUID REFERENCES channels(channel_id) ON DELETE CASCADE,
        external_product_id VARCHAR(255) NOT NULL, -- Product ID in external channel
        external_variant_id VARCHAR(255),
        channel_sku VARCHAR(255),
        channel_product_name VARCHAR(500),
        sync_enabled BOOLEAN DEFAULT true,
        last_synced TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, channel_id),
        UNIQUE(channel_id, external_product_id)
      )
    `);
    console.log("Created channel_products table");

    // Create inventory_allocations table for managing stock across channels
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory_allocations (
        allocation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        channel_id UUID REFERENCES channels(channel_id) ON DELETE CASCADE,
        allocated_quantity INTEGER NOT NULL DEFAULT 0,
        reserved_quantity INTEGER DEFAULT 0,
        buffer_quantity INTEGER DEFAULT 0,
        priority INTEGER DEFAULT 1, -- Higher number = higher priority
        allocation_rules JSONB DEFAULT '{}',
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, channel_id),
        CHECK (allocated_quantity >= 0),
        CHECK (reserved_quantity >= 0),
        CHECK (buffer_quantity >= 0)
      )
    `);
    console.log("Created inventory_allocations table");

    // Create sync_status table for tracking synchronization status
    await db.query(`
      CREATE TABLE IF NOT EXISTS sync_status (
        sync_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID REFERENCES stores(store_id) ON DELETE CASCADE,
        channel_id UUID REFERENCES channels(channel_id) ON DELETE CASCADE,
        sync_type VARCHAR(50) NOT NULL, -- 'inventory', 'orders', 'products'
        status VARCHAR(50) NOT NULL, -- 'pending', 'running', 'completed', 'failed', 'paused'
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        total_records INTEGER DEFAULT 0,
        processed_records INTEGER DEFAULT 0,
        successful_records INTEGER DEFAULT 0,
        failed_records INTEGER DEFAULT 0,
        error_message TEXT,
        sync_details JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created sync_status table");

    // Create sync_conflicts table for tracking and resolving conflicts
    await db.query(`
      CREATE TABLE IF NOT EXISTS sync_conflicts (
        conflict_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        conflict_type VARCHAR(50) NOT NULL, -- 'stock_mismatch', 'price_mismatch', 'product_mismatch'
        priority VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
        status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'resolving', 'resolved', 'ignored'
        conflict_data JSONB NOT NULL, -- Details of the conflict
        resolution_strategy VARCHAR(100),
        resolved_by UUID REFERENCES users(user_id),
        resolved_at TIMESTAMP,
        auto_resolved BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created sync_conflicts table");

    // Create webhook_logs table for tracking all webhook activity
    await db.query(`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel_id UUID REFERENCES channels(channel_id) ON DELETE CASCADE,
        webhook_type VARCHAR(100) NOT NULL,
        http_method VARCHAR(10) NOT NULL,
        payload JSONB,
        headers JSONB,
        signature VARCHAR(500),
        signature_valid BOOLEAN,
        processing_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processed', 'failed', 'ignored'
        processing_time_ms INTEGER,
        error_message TEXT,
        response_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP
      )
    `);
    console.log("Created webhook_logs table");

    // Insert default channels
    await db.query(`
      INSERT INTO channels (channel_type, channel_name, rate_limit_per_minute, configuration) VALUES
      ('shopify', 'Shopify', 40, '{"api_version": "2023-10", "scopes": ["read_orders", "write_inventory", "read_products"]}'),
      ('amazon', 'Amazon Seller Central', 200, '{"marketplace_id": "ATVPDKIKX0DER", "region": "us-east-1"}'),
      ('ebay', 'eBay', 5000, '{"site_id": "0", "compatibility_level": "1193"}'),
      ('square', 'Square POS', 1000, '{"environment": "production", "application_id": null}'),
      ('custom', 'Custom REST API', 60, '{"base_url": null, "auth_type": "bearer"}')
      ON CONFLICT DO NOTHING
    `);
    console.log("Inserted default channels");

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
      
      -- New indexes for forecast accuracy and dead stock analysis
      CREATE INDEX IF NOT EXISTS idx_forecast_accuracy_product_date ON forecast_accuracy(product_id, forecast_date);
      CREATE INDEX IF NOT EXISTS idx_forecast_accuracy_date ON forecast_accuracy(forecast_date);
      CREATE INDEX IF NOT EXISTS idx_forecast_accuracy_accuracy ON forecast_accuracy(accuracy_percentage);
      CREATE INDEX IF NOT EXISTS idx_dead_stock_analysis_product ON dead_stock_analysis(product_id);
      CREATE INDEX IF NOT EXISTS idx_dead_stock_analysis_date ON dead_stock_analysis(analysis_date);
      CREATE INDEX IF NOT EXISTS idx_dead_stock_classification ON dead_stock_analysis(dead_stock_classification);
      CREATE INDEX IF NOT EXISTS idx_forecast_accuracy_metrics_product_period ON forecast_accuracy_metrics(product_id, time_period, period_start);
      CREATE INDEX IF NOT EXISTS idx_external_factors_date ON external_factors(factor_date);
      CREATE INDEX IF NOT EXISTS idx_external_factors_type ON external_factors(factor_type);
      CREATE INDEX IF NOT EXISTS idx_external_factors_product ON external_factors(product_id);
      
      -- Multi-channel indexes
      CREATE INDEX IF NOT EXISTS idx_channel_credentials_store_channel ON channel_credentials(store_id, channel_id);
      CREATE INDEX IF NOT EXISTS idx_channel_products_product_channel ON channel_products(product_id, channel_id);
      CREATE INDEX IF NOT EXISTS idx_channel_products_external_id ON channel_products(channel_id, external_product_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_allocations_product_channel ON inventory_allocations(product_id, channel_id);
      CREATE INDEX IF NOT EXISTS idx_sync_status_store_channel ON sync_status(store_id, channel_id);
      CREATE INDEX IF NOT EXISTS idx_sync_status_status ON sync_status(status);
      CREATE INDEX IF NOT EXISTS idx_sync_status_started_at ON sync_status(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sync_conflicts_product ON sync_conflicts(product_id);
      CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON sync_conflicts(status);
      CREATE INDEX IF NOT EXISTS idx_sync_conflicts_priority ON sync_conflicts(priority);
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_channel ON webhook_logs(channel_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON webhook_logs(processing_status);
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

    // === SUPPLIER INTEGRATION AND PURCHASE ORDERS TABLES (Ticket #4) ===

    // Create suppliers table
    await db.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        supplier_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID REFERENCES stores(store_id) ON DELETE CASCADE,
        supplier_name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(50),
        address_line1 VARCHAR(255),
        address_line2 VARCHAR(255),
        city VARCHAR(100),
        state_province VARCHAR(100),
        postal_code VARCHAR(20),
        country VARCHAR(100),
        payment_terms VARCHAR(100), -- e.g., "Net 30", "2/10 Net 30"
        currency VARCHAR(3) DEFAULT 'USD',
        tax_id VARCHAR(50),
        website VARCHAR(255),
        notes TEXT,
        is_active BOOLEAN DEFAULT true,
        preferred_supplier BOOLEAN DEFAULT false,
        supplier_rating DECIMAL(3,2) DEFAULT 0, -- 0.00 to 5.00
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created suppliers table");

    // Create supplier_products table for product-supplier mapping
    await db.query(`
      CREATE TABLE IF NOT EXISTS supplier_products (
        supplier_product_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        supplier_id UUID REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        supplier_sku VARCHAR(255),
        supplier_product_name VARCHAR(255),
        lead_time_days INTEGER NOT NULL DEFAULT 7,
        minimum_order_quantity INTEGER DEFAULT 1,
        cost_per_unit DECIMAL(10,2) NOT NULL,
        bulk_pricing JSONB DEFAULT '[]', -- Array of quantity breaks and prices
        last_cost_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_primary_supplier BOOLEAN DEFAULT false,
        discontinued BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(supplier_id, product_id)
      )
    `);
    console.log("Created supplier_products table");

    // Create purchase_orders table
    await db.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        po_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID REFERENCES stores(store_id) ON DELETE CASCADE,
        supplier_id UUID REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
        po_number VARCHAR(50) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'draft', -- draft, submitted, approved, rejected, received, cancelled
        total_amount DECIMAL(12,2) DEFAULT 0,
        currency VARCHAR(3) DEFAULT 'USD',
        expected_delivery_date DATE,
        actual_delivery_date DATE,
        payment_terms VARCHAR(100),
        shipping_address JSONB,
        billing_address JSONB,
        notes TEXT,
        created_by UUID REFERENCES users(user_id),
        approved_by UUID REFERENCES users(user_id),
        approved_at TIMESTAMP,
        submitted_at TIMESTAMP,
        received_at TIMESTAMP,
        cancelled_at TIMESTAMP,
        cancellation_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created purchase_orders table");

    // Create purchase_order_items table
    await db.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        po_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        po_id UUID REFERENCES purchase_orders(po_id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        supplier_product_id UUID REFERENCES supplier_products(supplier_product_id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_cost DECIMAL(10,2) NOT NULL,
        total_cost DECIMAL(12,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
        quantity_received INTEGER DEFAULT 0 CHECK (quantity_received >= 0),
        quantity_pending INTEGER GENERATED ALWAYS AS (quantity - quantity_received) STORED,
        expected_delivery_date DATE,
        actual_delivery_date DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CHECK (quantity_received <= quantity)
      )
    `);
    console.log("Created purchase_order_items table");

    // Create approval_workflows table
    await db.query(`
      CREATE TABLE IF NOT EXISTS approval_workflows (
        workflow_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id UUID REFERENCES stores(store_id) ON DELETE CASCADE,
        workflow_name VARCHAR(255) NOT NULL,
        description TEXT,
        workflow_type VARCHAR(50) NOT NULL, -- 'purchase_order', 'expense', 'adjustment'
        trigger_conditions JSONB NOT NULL, -- Conditions that trigger this workflow
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created approval_workflows table");

    // Create approval_workflow_steps table
    await db.query(`
      CREATE TABLE IF NOT EXISTS approval_workflow_steps (
        step_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id UUID REFERENCES approval_workflows(workflow_id) ON DELETE CASCADE,
        step_order INTEGER NOT NULL,
        step_name VARCHAR(255) NOT NULL,
        approver_user_id UUID REFERENCES users(user_id),
        approver_role VARCHAR(100), -- Alternative to specific user
        approval_criteria JSONB, -- Additional criteria for this step
        is_required BOOLEAN DEFAULT true,
        timeout_hours INTEGER DEFAULT 72,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(workflow_id, step_order)
      )
    `);
    console.log("Created approval_workflow_steps table");

    // Create purchase_order_approvals table
    await db.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_approvals (
        approval_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        po_id UUID REFERENCES purchase_orders(po_id) ON DELETE CASCADE,
        workflow_id UUID REFERENCES approval_workflows(workflow_id),
        step_id UUID REFERENCES approval_workflow_steps(step_id),
        approver_user_id UUID REFERENCES users(user_id),
        status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected, skipped
        approval_date TIMESTAMP,
        rejection_reason TEXT,
        comments TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created purchase_order_approvals table");

    // Create supplier_performance table
    await db.query(`
      CREATE TABLE IF NOT EXISTS supplier_performance (
        performance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        supplier_id UUID REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
        po_id UUID REFERENCES purchase_orders(po_id),
        metric_type VARCHAR(50) NOT NULL, -- delivery_time, quality, communication
        metric_value DECIMAL(10,2),
        metric_unit VARCHAR(20), -- days, percentage, rating
        measurement_date DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created supplier_performance table");

    // Create reorder_rules table
    await db.query(`
      CREATE TABLE IF NOT EXISTS reorder_rules (
        rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
        supplier_id UUID REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
        reorder_point INTEGER NOT NULL CHECK (reorder_point >= 0),
        reorder_quantity INTEGER NOT NULL CHECK (reorder_quantity > 0),
        safety_stock INTEGER DEFAULT 0 CHECK (safety_stock >= 0),
        seasonal_adjustment_factor DECIMAL(5,2) DEFAULT 1.00,
        auto_reorder_enabled BOOLEAN DEFAULT false,
        rule_priority INTEGER DEFAULT 1, -- Higher number = higher priority
        effective_from DATE DEFAULT CURRENT_DATE,
        effective_until DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(product_id, supplier_id)
      )
    `);
    console.log("Created reorder_rules table");

    // Create supplier_communications table for tracking communications
    await db.query(`
      CREATE TABLE IF NOT EXISTS supplier_communications (
        communication_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        supplier_id UUID REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
        po_id UUID REFERENCES purchase_orders(po_id),
        communication_type VARCHAR(50) NOT NULL, -- email, phone, edi, portal
        direction VARCHAR(10) NOT NULL, -- inbound, outbound
        subject VARCHAR(255),
        content TEXT,
        status VARCHAR(50) DEFAULT 'sent', -- sent, delivered, read, responded, failed
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        delivered_at TIMESTAMP,
        responded_at TIMESTAMP,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("Created supplier_communications table");

    // Insert default approval workflow for purchase orders
    await db.query(`
      INSERT INTO approval_workflows (workflow_name, description, workflow_type, trigger_conditions, is_active)
      VALUES 
      ('Default PO Approval', 'Default approval workflow for purchase orders over $500', 'purchase_order', 
       '{"min_amount": 500, "conditions": [{"field": "total_amount", "operator": "gte", "value": 500}]}', true)
      ON CONFLICT DO NOTHING
    `);
    console.log("Inserted default approval workflow");

    // Create indexes for supplier and purchase order tables
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_suppliers_store_active ON suppliers(store_id, is_active);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_supplier_products_product_supplier ON supplier_products(product_id, supplier_id);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier_primary ON supplier_products(supplier_id, is_primary_supplier);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_store_status ON purchase_orders(store_id, status);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_status ON purchase_orders(supplier_id, status);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at ON purchase_orders(created_at DESC);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po ON purchase_order_items(po_id);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product ON purchase_order_items(product_id);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_purchase_order_approvals_po_status ON purchase_order_approvals(po_id, status);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_supplier_performance_supplier_date ON supplier_performance(supplier_id, measurement_date DESC);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_reorder_rules_product ON reorder_rules(product_id);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_reorder_rules_auto_enabled ON reorder_rules(auto_reorder_enabled) WHERE auto_reorder_enabled = true;
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_supplier_communications_supplier_date ON supplier_communications(supplier_id, sent_at DESC);
    `);

    console.log("Created indexes for supplier and purchase order tables");

    console.log("Database migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
};

createTables();
