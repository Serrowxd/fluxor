const db = require("../../config/database");
const { v4: uuidv4 } = require("uuid");

class Analytics {
  // Inventory Turnover Rate Calculation
  static async calculateInventoryTurnover(
    storeId,
    period = "30 days",
    productId = null
  ) {
    let query = `
      WITH cogs_data AS (
        SELECT 
          p.product_id,
          p.product_name,
          p.sku,
          SUM(s.quantity_sold * COALESCE(p.unit_cost, 0)) as cogs,
          COUNT(s.sale_id) as transaction_count
        FROM products p
        LEFT JOIN sales s ON p.product_id = s.product_id
        WHERE p.store_id = $1
        AND s.sale_date >= NOW() - INTERVAL '1 ${period}'
    `;

    const params = [storeId];

    if (productId) {
      query += ` AND p.product_id = $${params.length + 1}`;
      params.push(productId);
    }

    query += ` GROUP BY p.product_id, p.product_name, p.sku ),
      avg_inventory AS (
        SELECT 
          p.product_id,
          AVG(i.current_stock * COALESCE(p.unit_cost, 0)) as avg_inventory_value
        FROM products p
        LEFT JOIN inventory i ON p.product_id = i.product_id
        WHERE p.store_id = $1
    `;

    if (productId) {
      query += ` AND p.product_id = $${productId ? 2 : "NULL"}`;
    }

    query += ` GROUP BY p.product_id )
      SELECT 
        c.product_id,
        c.product_name,
        c.sku,
        c.cogs,
        a.avg_inventory_value,
        CASE 
          WHEN a.avg_inventory_value > 0 
          THEN ROUND((c.cogs / a.avg_inventory_value)::numeric, 2)
          ELSE 0 
        END as turnover_ratio,
        CASE 
          WHEN c.cogs / a.avg_inventory_value >= 6 THEN 'excellent'
          WHEN c.cogs / a.avg_inventory_value >= 4 THEN 'good'
          WHEN c.cogs / a.avg_inventory_value >= 2 THEN 'fair'
          ELSE 'poor'
        END as performance_category,
        c.transaction_count
      FROM cogs_data c
      LEFT JOIN avg_inventory a ON c.product_id = a.product_id
      ORDER BY turnover_ratio DESC`;

    const result = await db.query(query, params);
    return result.rows;
  }

  // Stockout Rate Tracking
  static async calculateStockoutRate(storeId, period = "30 days") {
    const query = `
      WITH stockout_data AS (
        SELECT 
          p.product_id,
          p.product_name,
          p.sku,
          COUNT(se.stockout_id) as stockout_events,
          SUM(COALESCE(se.duration_hours, 0)) as total_stockout_hours,
          SUM(COALESCE(se.lost_sales_estimate, 0)) as lost_sales,
          SUM(COALESCE(se.lost_revenue_estimate, 0)) as lost_revenue,
          COUNT(DISTINCT DATE(se.stockout_date)) as stockout_days
        FROM products p
        LEFT JOIN stockout_events se ON p.product_id = se.product_id
          AND se.stockout_date >= NOW() - INTERVAL '1 ${period}'
        WHERE p.store_id = $1
        GROUP BY p.product_id, p.product_name, p.sku
      ),
      total_demand AS (
        SELECT 
          p.product_id,
          COUNT(s.sale_id) as total_orders,
          SUM(s.quantity_sold) as total_demand_quantity
        FROM products p
        LEFT JOIN sales s ON p.product_id = s.product_id
          AND s.sale_date >= NOW() - INTERVAL '1 ${period}'
        WHERE p.store_id = $1
        GROUP BY p.product_id
      )
      SELECT 
        s.product_id,
        s.product_name,
        s.sku,
        s.stockout_events,
        s.total_stockout_hours,
        s.lost_sales,
        s.lost_revenue,
        s.stockout_days,
        t.total_orders,
        t.total_demand_quantity,
        CASE 
          WHEN t.total_orders > 0 
          THEN ROUND((s.stockout_events::numeric / t.total_orders * 100), 2)
          ELSE 0 
        END as stockout_rate_percent,
        CASE 
          WHEN t.total_demand_quantity > 0 
          THEN ROUND((s.lost_sales::numeric / t.total_demand_quantity * 100), 2)
          ELSE 0 
        END as lost_sales_rate_percent
      FROM stockout_data s
      LEFT JOIN total_demand t ON s.product_id = t.product_id
      ORDER BY stockout_rate_percent DESC, lost_revenue DESC`;

    const result = await db.query(query, [storeId]);
    return result.rows;
  }

  // Carrying Cost Analysis
  static async calculateCarryingCosts(storeId, productId = null) {
    let query = `
      SELECT 
        p.product_id,
        p.product_name,
        p.sku,
        p.unit_cost,
        i.current_stock,
        i.storage_cost_per_unit,
        i.insurance_rate,
        ROUND((i.current_stock * p.unit_cost)::numeric, 2) as inventory_value,
        ROUND((i.current_stock * i.storage_cost_per_unit)::numeric, 2) as storage_cost,
        ROUND((i.current_stock * p.unit_cost * i.insurance_rate)::numeric, 2) as insurance_cost,
        ROUND((
          (i.current_stock * i.storage_cost_per_unit) + 
          (i.current_stock * p.unit_cost * i.insurance_rate)
        )::numeric, 2) as total_carrying_cost,
        CASE 
          WHEN i.current_stock * p.unit_cost > 0 
          THEN ROUND((
            ((i.current_stock * i.storage_cost_per_unit) + 
             (i.current_stock * p.unit_cost * i.insurance_rate)) /
            (i.current_stock * p.unit_cost) * 100
          )::numeric, 2)
          ELSE 0 
        END as carrying_cost_percentage
      FROM products p
      JOIN inventory i ON p.product_id = i.product_id
      WHERE p.store_id = $1
    `;

    const params = [storeId];

    if (productId) {
      query += ` AND p.product_id = $${params.length + 1}`;
      params.push(productId);
    }

    query += ` ORDER BY total_carrying_cost DESC`;

    const result = await db.query(query, params);
    return result.rows;
  }

  // Gross Margin Analysis
  static async calculateGrossMargins(
    storeId,
    period = "30 days",
    productId = null
  ) {
    let query = `
      WITH sales_data AS (
        SELECT 
          p.product_id,
          p.product_name,
          p.sku,
          p.unit_cost,
          p.selling_price,
          SUM(s.quantity_sold) as total_quantity_sold,
          SUM(s.total_revenue) as total_revenue,
          AVG(s.unit_price) as avg_selling_price
        FROM products p
        LEFT JOIN sales s ON p.product_id = s.product_id
        WHERE p.store_id = $1
        AND s.sale_date >= NOW() - INTERVAL '1 ${period}'
    `;

    const params = [storeId];

    if (productId) {
      query += ` AND p.product_id = $${params.length + 1}`;
      params.push(productId);
    }

    query += ` GROUP BY p.product_id, p.product_name, p.sku, p.unit_cost, p.selling_price )
      SELECT 
        s.product_id,
        s.product_name,
        s.sku,
        s.unit_cost,
        s.selling_price,
        s.avg_selling_price,
        s.total_quantity_sold,
        s.total_revenue,
        ROUND((s.total_quantity_sold * s.unit_cost)::numeric, 2) as total_cost,
        ROUND((s.total_revenue - (s.total_quantity_sold * s.unit_cost))::numeric, 2) as gross_profit,
        CASE 
          WHEN s.total_revenue > 0 
          THEN ROUND(((s.total_revenue - (s.total_quantity_sold * s.unit_cost)) / s.total_revenue * 100)::numeric, 2)
          ELSE 0 
        END as gross_margin_percentage,
        CASE 
          WHEN s.selling_price > 0 AND s.unit_cost > 0 
          THEN ROUND(((s.selling_price - s.unit_cost) / s.selling_price * 100)::numeric, 2)
          ELSE 0 
        END as list_price_margin_percentage,
        CASE 
          WHEN s.total_revenue > 0 
          THEN ROUND((s.total_revenue / s.total_quantity_sold)::numeric, 2)
          ELSE 0 
        END as avg_revenue_per_unit
      FROM sales_data s
      WHERE s.total_quantity_sold > 0
      ORDER BY gross_profit DESC`;

    const result = await db.query(query, params);
    return result.rows;
  }

  // Stock Level Analytics with seasonal patterns
  static async getStockLevelAnalytics(storeId, period = "90 days") {
    const query = `
      WITH daily_stock AS (
        SELECT 
          p.product_id,
          p.product_name,
          p.sku,
          i.current_stock,
          i.reorder_point,
          i.max_stock_level,
          EXTRACT(DOW FROM NOW()) as current_day_of_week,
          EXTRACT(MONTH FROM NOW()) as current_month
        FROM products p
        JOIN inventory i ON p.product_id = i.product_id
        WHERE p.store_id = $1
      ),
      historical_sales AS (
        SELECT 
          p.product_id,
          EXTRACT(DOW FROM s.sale_date) as day_of_week,
          EXTRACT(MONTH FROM s.sale_date) as month,
          AVG(s.quantity_sold) as avg_daily_sales,
          STDDEV(s.quantity_sold) as sales_volatility
        FROM products p
        JOIN sales s ON p.product_id = s.product_id
        WHERE p.store_id = $1
        AND s.sale_date >= NOW() - INTERVAL '1 ${period}'
        GROUP BY p.product_id, EXTRACT(DOW FROM s.sale_date), EXTRACT(MONTH FROM s.sale_date)
      ),
      seasonal_factors AS (
        SELECT 
          ds.product_id,
          ds.product_name,
          ds.sku,
          ds.current_stock,
          ds.reorder_point,
          ds.max_stock_level,
          COALESCE(hs_dow.avg_daily_sales, 0) as avg_sales_current_dow,
          COALESCE(hs_month.avg_daily_sales, 0) as avg_sales_current_month,
          COALESCE(hs_dow.sales_volatility, 0) as dow_volatility,
          COALESCE(hs_month.sales_volatility, 0) as month_volatility
        FROM daily_stock ds
        LEFT JOIN historical_sales hs_dow ON ds.product_id = hs_dow.product_id 
          AND ds.current_day_of_week = hs_dow.day_of_week
        LEFT JOIN historical_sales hs_month ON ds.product_id = hs_month.product_id 
          AND ds.current_month = hs_month.month
      )
      SELECT 
        sf.*,
        CASE 
          WHEN sf.current_stock = 0 THEN 'stockout'
          WHEN sf.current_stock <= sf.reorder_point THEN 'critical'
          WHEN sf.current_stock <= (sf.reorder_point * 1.5) THEN 'low'
          WHEN sf.current_stock >= sf.max_stock_level THEN 'overstock'
          ELSE 'normal'
        END as stock_status,
        CASE 
          WHEN sf.avg_sales_current_dow > 0 
          THEN ROUND((sf.current_stock / sf.avg_sales_current_dow)::numeric, 1)
          ELSE NULL 
        END as days_of_supply_dow,
        CASE 
          WHEN sf.avg_sales_current_month > 0 
          THEN ROUND((sf.current_stock / sf.avg_sales_current_month)::numeric, 1)
          ELSE NULL 
        END as days_of_supply_month,
        ROUND((sf.dow_volatility + sf.month_volatility)::numeric, 2) as total_volatility
      FROM seasonal_factors sf
      ORDER BY 
        CASE 
          WHEN sf.current_stock = 0 THEN 1
          WHEN sf.current_stock <= sf.reorder_point THEN 2
          WHEN sf.current_stock <= (sf.reorder_point * 1.5) THEN 3
          WHEN sf.current_stock >= sf.max_stock_level THEN 4
          ELSE 5
        END,
        sf.product_name`;

    const result = await db.query(query, [storeId]);
    return result.rows;
  }

  // Get comprehensive dashboard metrics
  static async getDashboardMetrics(storeId) {
    try {
      const [
        turnoverData,
        stockoutData,
        carryingCostData,
        marginData,
        stockAnalyticsData,
      ] = await Promise.all([
        this.calculateInventoryTurnover(storeId, "30 days"),
        this.calculateStockoutRate(storeId, "30 days"),
        this.calculateCarryingCosts(storeId),
        this.calculateGrossMargins(storeId, "30 days"),
        this.getStockLevelAnalytics(storeId, "90 days"),
      ]);

      // Calculate summary statistics
      const totalProducts = stockAnalyticsData.length;
      const criticalStockProducts = stockAnalyticsData.filter(
        (p) => p.stock_status === "critical"
      ).length;
      const lowStockProducts = stockAnalyticsData.filter(
        (p) => p.stock_status === "low"
      ).length;
      const overstockProducts = stockAnalyticsData.filter(
        (p) => p.stock_status === "overstock"
      ).length;

      const totalInventoryValue = carryingCostData.reduce(
        (sum, product) => sum + (product.inventory_value || 0),
        0
      );
      const totalCarryingCost = carryingCostData.reduce(
        (sum, product) => sum + (product.total_carrying_cost || 0),
        0
      );

      const avgTurnoverRatio =
        turnoverData.length > 0
          ? turnoverData.reduce(
              (sum, product) => sum + (product.turnover_ratio || 0),
              0
            ) / turnoverData.length
          : 0;

      const totalLostRevenue = stockoutData.reduce(
        (sum, product) => sum + (product.lost_revenue || 0),
        0
      );
      const avgStockoutRate =
        stockoutData.length > 0
          ? stockoutData.reduce(
              (sum, product) => sum + (product.stockout_rate_percent || 0),
              0
            ) / stockoutData.length
          : 0;

      const avgGrossMargin =
        marginData.length > 0
          ? marginData.reduce(
              (sum, product) => sum + (product.gross_margin_percentage || 0),
              0
            ) / marginData.length
          : 0;

      return {
        summary: {
          totalProducts,
          criticalStockProducts,
          lowStockProducts,
          overstockProducts,
          totalInventoryValue: Math.round(totalInventoryValue * 100) / 100,
          totalCarryingCost: Math.round(totalCarryingCost * 100) / 100,
          carryingCostPercentage:
            totalInventoryValue > 0
              ? Math.round((totalCarryingCost / totalInventoryValue) * 10000) /
                100
              : 0,
          avgTurnoverRatio: Math.round(avgTurnoverRatio * 100) / 100,
          totalLostRevenue: Math.round(totalLostRevenue * 100) / 100,
          avgStockoutRate: Math.round(avgStockoutRate * 100) / 100,
          avgGrossMargin: Math.round(avgGrossMargin * 100) / 100,
        },
        details: {
          turnover: turnoverData,
          stockouts: stockoutData,
          carryingCosts: carryingCostData,
          margins: marginData,
          stockAnalytics: stockAnalyticsData,
        },
      };
    } catch (error) {
      console.error("Error calculating dashboard metrics:", error);
      throw error;
    }
  }

  // Cache analytics data
  static async cacheAnalytics(cacheKey, data, ttlMinutes = 60) {
    const cacheId = uuidv4();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await db.query(
      `INSERT INTO analytics_cache (cache_id, cache_key, cache_data, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cache_key) 
       DO UPDATE SET 
         cache_data = $3, 
         expires_at = $4, 
         created_at = CURRENT_TIMESTAMP`,
      [cacheId, cacheKey, JSON.stringify(data), expiresAt]
    );
  }

  // Get cached analytics data
  static async getCachedAnalytics(cacheKey) {
    const result = await db.query(
      `SELECT cache_data FROM analytics_cache 
       WHERE cache_key = $1 AND expires_at > NOW()`,
      [cacheKey]
    );

    return result.rows.length > 0
      ? JSON.parse(result.rows[0].cache_data)
      : null;
  }

  // Clear expired cache entries
  static async clearExpiredCache() {
    const result = await db.query(
      "DELETE FROM analytics_cache WHERE expires_at <= NOW() RETURNING cache_id"
    );

    console.log(`Cleared ${result.rows.length} expired cache entries`);
    return result.rows.length;
  }
}

module.exports = Analytics;
