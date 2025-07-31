const db = require("../../config/database");

/**
 * ReorderPointEngine
 *
 * Advanced service for calculating optimal reorder points, safety stock,
 * and Economic Order Quantities (EOQ) with seasonal adjustments.
 * Uses statistical analysis and demand forecasting for optimization.
 */
class ReorderPointEngine {
  /**
   * Calculate optimal reorder point for a product
   * @param {string} productId - Product ID
   * @param {Object} options - Calculation options
   * @returns {Promise<Object>} Reorder point analysis
   */
  async calculateReorderPoint(productId, options = {}) {
    try {
      const {
        supplierId,
        analysisWindow = 90, // days
        serviceLevel = 0.95, // 95% service level
        leadTimeBuffer = 1.2, // 20% buffer on lead time
        seasonalAdjustment = true,
      } = options;

      // Get product and supplier information
      const productInfo = await this.getProductSupplierInfo(
        productId,
        supplierId
      );
      if (!productInfo) {
        throw new Error("Product or supplier information not found");
      }

      // Calculate demand statistics
      const demandStats = await this.calculateDemandStatistics(
        productId,
        analysisWindow
      );

      // Calculate lead time statistics
      const leadTimeStats = await this.calculateLeadTimeStatistics(
        productId,
        supplierId,
        analysisWindow
      );

      // Calculate safety stock
      const safetyStock = await this.calculateSafetyStock(
        demandStats,
        leadTimeStats,
        serviceLevel
      );

      // Calculate base reorder point
      const averageLeadTime = leadTimeStats.average_lead_time * leadTimeBuffer;
      const baseReorderPoint = Math.ceil(
        demandStats.average_daily_demand * averageLeadTime + safetyStock
      );

      // Apply seasonal adjustments if enabled
      let seasonalFactor = 1.0;
      if (seasonalAdjustment) {
        seasonalFactor = await this.calculateSeasonalFactor(productId);
      }

      const adjustedReorderPoint = Math.ceil(baseReorderPoint * seasonalFactor);

      // Calculate EOQ
      const eoq = await this.calculateEOQ(productId, supplierId, demandStats);

      return {
        product_id: productId,
        supplier_id: supplierId,
        analysis_window_days: analysisWindow,
        demand_statistics: demandStats,
        lead_time_statistics: leadTimeStats,
        safety_stock: safetyStock,
        base_reorder_point: baseReorderPoint,
        seasonal_factor: seasonalFactor,
        recommended_reorder_point: adjustedReorderPoint,
        economic_order_quantity: eoq,
        service_level: serviceLevel,
        confidence_score: this.calculateConfidenceScore(
          demandStats,
          leadTimeStats
        ),
        last_calculated: new Date(),
      };
    } catch (error) {
      throw new Error(`Failed to calculate reorder point: ${error.message}`);
    }
  }

  /**
   * Get product and supplier information
   * @param {string} productId - Product ID
   * @param {string} supplierId - Supplier ID (optional)
   * @returns {Promise<Object>} Product and supplier info
   */
  async getProductSupplierInfo(productId, supplierId = null) {
    try {
      let query = `
        SELECT 
          p.*,
          sp.supplier_id,
          sp.lead_time_days,
          sp.minimum_order_quantity,
          sp.cost_per_unit,
          s.supplier_name
        FROM products p
        LEFT JOIN supplier_products sp ON p.product_id = sp.product_id
        LEFT JOIN suppliers s ON sp.supplier_id = s.supplier_id
        WHERE p.product_id = $1
      `;

      const params = [productId];

      if (supplierId) {
        query += ` AND sp.supplier_id = $2`;
        params.push(supplierId);
      } else {
        query += ` AND (sp.is_primary_supplier = true OR sp.supplier_id IS NULL)`;
      }

      query += ` LIMIT 1`;

      const result = await db.query(query, params);
      return result.rows[0] || null;
    } catch (error) {
      throw new Error(`Failed to get product supplier info: ${error.message}`);
    }
  }

  /**
   * Calculate demand statistics for a product
   * @param {string} productId - Product ID
   * @param {number} windowDays - Analysis window in days
   * @returns {Promise<Object>} Demand statistics
   */
  async calculateDemandStatistics(productId, windowDays) {
    try {
      const result = await db.query(
        `
        WITH daily_demand AS (
          SELECT 
            DATE(sale_date) as sale_day,
            SUM(quantity_sold) as daily_demand
          FROM sales 
          WHERE product_id = $1 
          AND sale_date >= CURRENT_DATE - INTERVAL '${windowDays} days'
          GROUP BY DATE(sale_date)
        ),
        demand_stats AS (
          SELECT 
            COUNT(*) as days_with_sales,
            AVG(daily_demand) as avg_demand,
            STDDEV(daily_demand) as stddev_demand,
            MIN(daily_demand) as min_demand,
            MAX(daily_demand) as max_demand,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY daily_demand) as median_demand,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY daily_demand) as p95_demand
          FROM daily_demand
        ),
        zero_days AS (
          SELECT $2 - COUNT(DISTINCT DATE(sale_date)) as zero_demand_days
          FROM sales 
          WHERE product_id = $1 
          AND sale_date >= CURRENT_DATE - INTERVAL '${windowDays} days'
        )
        SELECT 
          ds.*,
          zd.zero_demand_days,
          ($2::float / NULLIF(ds.days_with_sales + zd.zero_demand_days, 0)) as demand_frequency,
          COALESCE(ds.avg_demand, 0) * ($2::float / NULLIF(ds.days_with_sales + zd.zero_demand_days, 0)) as average_daily_demand,
          CASE 
            WHEN ds.stddev_demand IS NOT NULL AND ds.avg_demand > 0 
            THEN ds.stddev_demand / ds.avg_demand 
            ELSE 0 
          END as coefficient_of_variation
        FROM demand_stats ds
        CROSS JOIN zero_days zd
      `,
        [productId, windowDays]
      );

      const stats = result.rows[0];

      return {
        analysis_window_days: windowDays,
        days_with_sales: parseInt(stats.days_with_sales) || 0,
        zero_demand_days: parseInt(stats.zero_demand_days) || windowDays,
        average_daily_demand: parseFloat(stats.average_daily_demand) || 0,
        demand_stddev: parseFloat(stats.stddev_demand) || 0,
        min_demand: parseFloat(stats.min_demand) || 0,
        max_demand: parseFloat(stats.max_demand) || 0,
        median_demand: parseFloat(stats.median_demand) || 0,
        p95_demand: parseFloat(stats.p95_demand) || 0,
        coefficient_of_variation:
          parseFloat(stats.coefficient_of_variation) || 0,
        demand_volatility: this.classifyDemandVolatility(
          parseFloat(stats.coefficient_of_variation) || 0
        ),
      };
    } catch (error) {
      throw new Error(
        `Failed to calculate demand statistics: ${error.message}`
      );
    }
  }

  /**
   * Calculate lead time statistics from historical purchase orders
   * @param {string} productId - Product ID
   * @param {string} supplierId - Supplier ID
   * @param {number} windowDays - Analysis window in days
   * @returns {Promise<Object>} Lead time statistics
   */
  async calculateLeadTimeStatistics(productId, supplierId, windowDays) {
    try {
      const result = await db.query(
        `
        WITH lead_times AS (
          SELECT 
            EXTRACT(DAY FROM (poi.actual_delivery_date - po.created_at)) as actual_lead_time
          FROM purchase_order_items poi
          JOIN purchase_orders po ON poi.po_id = po.po_id
          WHERE poi.product_id = $1
          AND po.supplier_id = $2
          AND poi.actual_delivery_date IS NOT NULL
          AND po.created_at >= CURRENT_DATE - INTERVAL '${windowDays} days'
        )
        SELECT 
          COUNT(*) as delivery_count,
          AVG(actual_lead_time) as average_lead_time,
          STDDEV(actual_lead_time) as stddev_lead_time,
          MIN(actual_lead_time) as min_lead_time,
          MAX(actual_lead_time) as max_lead_time,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY actual_lead_time) as median_lead_time,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY actual_lead_time) as p95_lead_time
        FROM lead_times
      `,
        [productId, supplierId, windowDays]
      );

      const stats = result.rows[0];

      // If no historical data, fall back to supplier's stated lead time
      if (parseInt(stats.delivery_count) === 0) {
        const supplierInfo = await db.query(
          `
          SELECT lead_time_days 
          FROM supplier_products 
          WHERE product_id = $1 AND supplier_id = $2
        `,
          [productId, supplierId]
        );

        const defaultLeadTime = supplierInfo.rows[0]?.lead_time_days || 7;

        return {
          delivery_count: 0,
          average_lead_time: defaultLeadTime,
          lead_time_stddev: defaultLeadTime * 0.2, // Assume 20% variance
          min_lead_time: defaultLeadTime,
          max_lead_time: defaultLeadTime,
          median_lead_time: defaultLeadTime,
          p95_lead_time: defaultLeadTime * 1.5,
          is_estimated: true,
          reliability_score: 0.5, // Low reliability due to no historical data
        };
      }

      return {
        delivery_count: parseInt(stats.delivery_count),
        average_lead_time: parseFloat(stats.average_lead_time),
        lead_time_stddev: parseFloat(stats.stddev_lead_time) || 0,
        min_lead_time: parseFloat(stats.min_lead_time),
        max_lead_time: parseFloat(stats.max_lead_time),
        median_lead_time: parseFloat(stats.median_lead_time),
        p95_lead_time: parseFloat(stats.p95_lead_time),
        is_estimated: false,
        reliability_score: Math.min(parseInt(stats.delivery_count) / 10, 1.0), // Max reliability at 10+ deliveries
      };
    } catch (error) {
      throw new Error(
        `Failed to calculate lead time statistics: ${error.message}`
      );
    }
  }

  /**
   * Calculate safety stock using statistical methods
   * @param {Object} demandStats - Demand statistics
   * @param {Object} leadTimeStats - Lead time statistics
   * @param {number} serviceLevel - Desired service level (0-1)
   * @returns {Promise<number>} Safety stock quantity
   */
  async calculateSafetyStock(demandStats, leadTimeStats, serviceLevel) {
    try {
      // Z-score for given service level
      const zScore = this.getZScore(serviceLevel);

      const avgDemand = demandStats.average_daily_demand;
      const demandStddev = demandStats.demand_stddev || 0;
      const avgLeadTime = leadTimeStats.average_lead_time;
      const leadTimeStddev = leadTimeStats.lead_time_stddev || 0;

      // Safety stock formula accounting for demand and lead time variability
      // SS = Z * sqrt((LT * σ_demand²) + (D * σ_leadtime²))
      const demandVariance = Math.pow(demandStddev, 2);
      const leadTimeVariance = Math.pow(leadTimeStddev, 2);

      const safetyStock =
        zScore *
        Math.sqrt(
          avgLeadTime * demandVariance +
            Math.pow(avgDemand, 2) * leadTimeVariance
        );

      // Minimum safety stock of 1 day's demand or 1 unit, whichever is higher
      const minimumSafetyStock = Math.max(1, Math.ceil(avgDemand));

      return Math.max(Math.ceil(safetyStock), minimumSafetyStock);
    } catch (error) {
      throw new Error(`Failed to calculate safety stock: ${error.message}`);
    }
  }

  /**
   * Calculate Economic Order Quantity (EOQ)
   * @param {string} productId - Product ID
   * @param {string} supplierId - Supplier ID
   * @param {Object} demandStats - Demand statistics
   * @returns {Promise<Object>} EOQ analysis
   */
  async calculateEOQ(productId, supplierId, demandStats) {
    try {
      // Get cost information
      const costInfo = await db.query(
        `
        SELECT 
          sp.cost_per_unit,
          sp.minimum_order_quantity,
          p.unit_cost as current_unit_cost
        FROM supplier_products sp
        JOIN products p ON sp.product_id = p.product_id
        WHERE sp.product_id = $1 AND sp.supplier_id = $2
      `,
        [productId, supplierId]
      );

      if (costInfo.rows.length === 0) {
        throw new Error("Cost information not found");
      }

      const { cost_per_unit, minimum_order_quantity } = costInfo.rows[0];

      // EOQ parameters
      const annualDemand = demandStats.average_daily_demand * 365;
      const orderingCost = 25; // Estimated ordering cost per order
      const carryingCost = cost_per_unit * 0.25; // 25% carrying cost rate

      // EOQ formula: sqrt((2 * D * S) / H)
      // D = Annual demand, S = Ordering cost per order, H = Carrying cost per unit per year
      const eoqQuantity = Math.sqrt(
        (2 * annualDemand * orderingCost) / carryingCost
      );

      // Ensure EOQ meets minimum order quantity
      const finalEOQ = Math.max(
        Math.ceil(eoqQuantity),
        minimum_order_quantity || 1
      );

      // Calculate total cost at EOQ
      const totalCost = this.calculateTotalCost(
        annualDemand,
        finalEOQ,
        orderingCost,
        carryingCost
      );

      return {
        economic_order_quantity: finalEOQ,
        theoretical_eoq: Math.ceil(eoqQuantity),
        annual_demand: Math.ceil(annualDemand),
        ordering_cost: orderingCost,
        carrying_cost_per_unit: carryingCost,
        total_annual_cost: totalCost,
        order_frequency_days: Math.ceil(
          finalEOQ / demandStats.average_daily_demand
        ),
        minimum_order_quantity,
        cost_per_unit,
      };
    } catch (error) {
      throw new Error(`Failed to calculate EOQ: ${error.message}`);
    }
  }

  /**
   * Calculate seasonal adjustment factor
   * @param {string} productId - Product ID
   * @returns {Promise<number>} Seasonal factor (1.0 = no adjustment)
   */
  async calculateSeasonalFactor(productId) {
    try {
      const currentMonth = new Date().getMonth() + 1;

      const result = await db.query(
        `
        WITH monthly_sales AS (
          SELECT 
            EXTRACT(MONTH FROM sale_date) as month,
            SUM(quantity_sold) as monthly_quantity
          FROM sales 
          WHERE product_id = $1 
          AND sale_date >= CURRENT_DATE - INTERVAL '2 years'
          GROUP BY EXTRACT(MONTH FROM sale_date)
        ),
        avg_monthly_sales AS (
          SELECT AVG(monthly_quantity) as overall_avg
          FROM monthly_sales
        )
        SELECT 
          COALESCE(ms.monthly_quantity / ams.overall_avg, 1.0) as seasonal_factor
        FROM monthly_sales ms
        CROSS JOIN avg_monthly_sales ams
        WHERE ms.month = $2
      `,
        [productId, currentMonth]
      );

      if (result.rows.length === 0) {
        return 1.0; // No seasonal adjustment if no data
      }

      const factor = parseFloat(result.rows[0].seasonal_factor);

      // Cap seasonal adjustments between 0.5 and 2.0 to prevent extreme values
      return Math.max(0.5, Math.min(2.0, factor));
    } catch (error) {
      console.error("Error calculating seasonal factor:", error);
      return 1.0; // Default to no adjustment on error
    }
  }

  /**
   * Apply reorder rule to a product
   * @param {string} productId - Product ID
   * @param {string} supplierId - Supplier ID
   * @param {Object} ruleData - Reorder rule configuration
   * @returns {Promise<Object>} Created/updated reorder rule
   */
  async applyReorderRule(productId, supplierId, ruleData) {
    try {
      const {
        reorder_point,
        reorder_quantity,
        safety_stock,
        auto_reorder_enabled = false,
        seasonal_adjustment_factor = 1.0,
        effective_from = new Date(),
        effective_until = null,
        rule_priority = 1,
      } = ruleData;

      const result = await db.query(
        `
        INSERT INTO reorder_rules (
          product_id, supplier_id, reorder_point, reorder_quantity,
          safety_stock, auto_reorder_enabled, seasonal_adjustment_factor,
          effective_from, effective_until, rule_priority
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (product_id, supplier_id) 
        DO UPDATE SET 
          reorder_point = EXCLUDED.reorder_point,
          reorder_quantity = EXCLUDED.reorder_quantity,
          safety_stock = EXCLUDED.safety_stock,
          auto_reorder_enabled = EXCLUDED.auto_reorder_enabled,
          seasonal_adjustment_factor = EXCLUDED.seasonal_adjustment_factor,
          effective_from = EXCLUDED.effective_from,
          effective_until = EXCLUDED.effective_until,
          rule_priority = EXCLUDED.rule_priority,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
        [
          productId,
          supplierId,
          reorder_point,
          reorder_quantity,
          safety_stock,
          auto_reorder_enabled,
          seasonal_adjustment_factor,
          effective_from,
          effective_until,
          rule_priority,
        ]
      );

      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to apply reorder rule: ${error.message}`);
    }
  }

  /**
   * Optimize reorder points for multiple products
   * @param {string} storeId - Store ID
   * @param {Object} options - Optimization options
   * @returns {Promise<Array>} Optimization results
   */
  async optimizeReorderPoints(storeId, options = {}) {
    try {
      const {
        productIds = null,
        supplierId = null,
        serviceLevel = 0.95,
        updateRules = false,
      } = options;

      // Get products to optimize
      let query = `
        SELECT DISTINCT
          p.product_id,
          sp.supplier_id,
          p.product_name,
          p.sku,
          s.supplier_name
        FROM products p
        JOIN supplier_products sp ON p.product_id = sp.product_id
        JOIN suppliers s ON sp.supplier_id = s.supplier_id
        WHERE p.store_id = $1
        AND s.is_active = true
        AND sp.discontinued = false
      `;

      const params = [storeId];
      let paramIndex = 1;

      if (productIds && productIds.length > 0) {
        query += ` AND p.product_id = ANY($${++paramIndex})`;
        params.push(productIds);
      }

      if (supplierId) {
        query += ` AND sp.supplier_id = $${++paramIndex}`;
        params.push(supplierId);
      }

      query += ` ORDER BY p.product_name`;

      const productsResult = await db.query(query, params);
      const products = productsResult.rows;

      const optimizationResults = [];

      for (const product of products) {
        try {
          const analysis = await this.calculateReorderPoint(
            product.product_id,
            {
              supplierId: product.supplier_id,
              serviceLevel,
            }
          );

          if (updateRules && analysis.confidence_score > 0.6) {
            await this.applyReorderRule(
              product.product_id,
              product.supplier_id,
              {
                reorder_point: analysis.recommended_reorder_point,
                reorder_quantity:
                  analysis.economic_order_quantity.economic_order_quantity,
                safety_stock: analysis.safety_stock,
                seasonal_adjustment_factor: analysis.seasonal_factor,
              }
            );
          }

          optimizationResults.push({
            ...product,
            analysis,
            status: "optimized",
          });
        } catch (error) {
          optimizationResults.push({
            ...product,
            error: error.message,
            status: "failed",
          });
        }
      }

      return {
        total_products: products.length,
        successful_optimizations: optimizationResults.filter(
          (r) => r.status === "optimized"
        ).length,
        failed_optimizations: optimizationResults.filter(
          (r) => r.status === "failed"
        ).length,
        results: optimizationResults,
        service_level: serviceLevel,
        rules_updated: updateRules,
      };
    } catch (error) {
      throw new Error(`Failed to optimize reorder points: ${error.message}`);
    }
  }

  // Helper methods

  /**
   * Get Z-score for given service level
   * @param {number} serviceLevel - Service level (0-1)
   * @returns {number} Z-score
   */
  getZScore(serviceLevel) {
    const zScores = {
      0.8: 0.84,
      0.85: 1.04,
      0.9: 1.28,
      0.95: 1.65,
      0.97: 1.88,
      0.99: 2.33,
      0.999: 3.09,
    };

    // Find closest service level
    const levels = Object.keys(zScores)
      .map(Number)
      .sort((a, b) => a - b);
    let closest = levels[0];

    for (const level of levels) {
      if (Math.abs(level - serviceLevel) < Math.abs(closest - serviceLevel)) {
        closest = level;
      }
    }

    return zScores[closest];
  }

  /**
   * Classify demand volatility based on coefficient of variation
   * @param {number} cv - Coefficient of variation
   * @returns {string} Volatility classification
   */
  classifyDemandVolatility(cv) {
    if (cv < 0.25) return "low";
    if (cv < 0.75) return "medium";
    if (cv < 1.5) return "high";
    return "very_high";
  }

  /**
   * Calculate confidence score for reorder point analysis
   * @param {Object} demandStats - Demand statistics
   * @param {Object} leadTimeStats - Lead time statistics
   * @returns {number} Confidence score (0-1)
   */
  calculateConfidenceScore(demandStats, leadTimeStats) {
    let score = 0;

    // Data availability score (40%)
    const dataScore = Math.min(demandStats.days_with_sales / 30, 1) * 0.4;
    score += dataScore;

    // Demand consistency score (30%)
    const demandConsistency =
      demandStats.coefficient_of_variation < 1
        ? (1 - demandStats.coefficient_of_variation) * 0.3
        : 0;
    score += demandConsistency;

    // Lead time reliability score (30%)
    const leadTimeReliability = leadTimeStats.reliability_score * 0.3;
    score += leadTimeReliability;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate total cost for EOQ analysis
   * @param {number} annualDemand - Annual demand
   * @param {number} orderQuantity - Order quantity
   * @param {number} orderingCost - Cost per order
   * @param {number} carryingCost - Carrying cost per unit per year
   * @returns {number} Total annual cost
   */
  calculateTotalCost(annualDemand, orderQuantity, orderingCost, carryingCost) {
    const orderingCostTotal = (annualDemand / orderQuantity) * orderingCost;
    const carryingCostTotal = (orderQuantity / 2) * carryingCost;
    return orderingCostTotal + carryingCostTotal;
  }
}

module.exports = ReorderPointEngine;
