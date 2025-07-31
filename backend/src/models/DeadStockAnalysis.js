const db = require("../../config/database");
const { v4: uuidv4 } = require("uuid");

class DeadStockAnalysis {
  /**
   * Create a new dead stock analysis record
   */
  static async create({
    productId,
    daysWithoutSale,
    currentStockValue,
    velocityScore = 0,
    deadStockClassification,
    liquidationPriority = 0,
    suggestedDiscountPercentage = 0,
    estimatedRecoveryValue = 0,
    clearanceRecommendation = null,
  }) {
    const analysisId = uuidv4();

    const result = await db.query(
      `INSERT INTO dead_stock_analysis (
        analysis_id, product_id, days_without_sale, current_stock_value, 
        velocity_score, dead_stock_classification, liquidation_priority,
        suggested_discount_percentage, estimated_recovery_value, clearance_recommendation
      ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING *`,
      [
        analysisId,
        productId,
        daysWithoutSale,
        currentStockValue,
        velocityScore,
        deadStockClassification,
        liquidationPriority,
        suggestedDiscountPercentage,
        estimatedRecoveryValue,
        clearanceRecommendation,
      ]
    );

    return result.rows[0];
  }

  /**
   * Analyze and identify dead stock for a store
   */
  static async analyzeDeadStock(storeId, config = {}) {
    const {
      slowMovingDays = 30,
      deadStockDays = 60,
      obsoleteDays = 90,
      minStockValue = 0,
      analysisDate = new Date().toISOString().split("T")[0],
    } = config;

    // First, identify products that haven't sold recently
    const query = `
      WITH last_sales AS (
        SELECT 
          p.product_id,
          MAX(s.sale_date) as last_sale_date,
          EXTRACT(DAYS FROM (CURRENT_DATE - MAX(s.sale_date))) as days_since_last_sale
        FROM products p
        LEFT JOIN sales s ON p.product_id = s.product_id
        WHERE p.store_id = $1
        GROUP BY p.product_id
      ),
      stock_info AS (
        SELECT 
          p.product_id,
          p.product_name,
          p.sku,
          p.unit_cost,
          p.selling_price,
          p.category,
          COALESCE(i.current_stock, 0) as current_stock,
          COALESCE(i.current_stock * p.unit_cost, 0) as current_stock_value,
          COALESCE(ls.last_sale_date, p.created_at::DATE) as last_sale_date,
          COALESCE(ls.days_since_last_sale, EXTRACT(DAYS FROM (CURRENT_DATE - p.created_at::DATE))) as days_without_sale
        FROM products p
        LEFT JOIN inventory i ON p.product_id = i.product_id
        LEFT JOIN last_sales ls ON p.product_id = ls.product_id
        WHERE p.store_id = $1
          AND COALESCE(i.current_stock * p.unit_cost, 0) >= $5
      ),
      velocity_calc AS (
        SELECT 
          si.*,
          CASE
            WHEN si.days_without_sale >= $4 THEN 'obsolete'
            WHEN si.days_without_sale >= $3 THEN 'dead_stock'
            WHEN si.days_without_sale >= $2 THEN 'slow_moving'
            ELSE 'normal'
          END as classification,
          -- Calculate velocity score (0-100, higher is better)
          CASE
            WHEN si.days_without_sale = 0 THEN 100
            ELSE GREATEST(0, 100 - (si.days_without_sale::FLOAT / 30 * 25))
          END as velocity_score
        FROM stock_info si
        WHERE si.days_without_sale >= $2  -- Only analyze slow-moving and worse
      )
      SELECT 
        vc.*,
        -- Calculate liquidation priority (1-10, higher is more urgent)
        CASE 
          WHEN vc.classification = 'obsolete' THEN LEAST(10, 7 + (vc.current_stock_value / 1000)::INTEGER)
          WHEN vc.classification = 'dead_stock' THEN LEAST(7, 4 + (vc.current_stock_value / 1000)::INTEGER)
          WHEN vc.classification = 'slow_moving' THEN LEAST(4, 1 + (vc.current_stock_value / 1000)::INTEGER)
          ELSE 1
        END as liquidation_priority,
        -- Suggested discount percentage
        CASE 
          WHEN vc.classification = 'obsolete' THEN 
            CASE 
              WHEN vc.days_without_sale > 180 THEN 70
              WHEN vc.days_without_sale > 120 THEN 50
              ELSE 30
            END
          WHEN vc.classification = 'dead_stock' THEN 
            CASE 
              WHEN vc.days_without_sale > 120 THEN 40
              WHEN vc.days_without_sale > 90 THEN 25
              ELSE 15
            END
          WHEN vc.classification = 'slow_moving' THEN 
            CASE 
              WHEN vc.days_without_sale > 60 THEN 20
              ELSE 10
            END
          ELSE 0
        END as suggested_discount_percentage
      FROM velocity_calc vc
      ORDER BY vc.liquidation_priority DESC, vc.current_stock_value DESC
    `;

    const result = await db.query(query, [
      storeId,
      slowMovingDays,
      deadStockDays,
      obsoleteDays,
      minStockValue,
    ]);

    // Calculate estimated recovery values and create analysis records
    const analysisRecords = [];
    for (const product of result.rows) {
      const discountedPrice =
        product.selling_price *
        (1 - product.suggested_discount_percentage / 100);
      const estimatedRecoveryValue = product.current_stock * discountedPrice;

      const clearanceRecommendation =
        this.generateClearanceRecommendation(product);

      const analysisRecord = {
        productId: product.product_id,
        daysWithoutSale: product.days_without_sale,
        currentStockValue: product.current_stock_value,
        velocityScore: product.velocity_score,
        deadStockClassification: product.classification,
        liquidationPriority: product.liquidation_priority,
        suggestedDiscountPercentage: product.suggested_discount_percentage,
        estimatedRecoveryValue: estimatedRecoveryValue,
        clearanceRecommendation: clearanceRecommendation,
      };

      analysisRecords.push(analysisRecord);
    }

    return analysisRecords;
  }

  /**
   * Generate clearance recommendation based on product analysis
   */
  static generateClearanceRecommendation(product) {
    const {
      classification,
      days_without_sale,
      current_stock_value,
      suggested_discount_percentage,
    } = product;

    let recommendation = "";

    switch (classification) {
      case "obsolete":
        if (days_without_sale > 180) {
          recommendation = `URGENT: Liquidate immediately. Consider bulk sale to liquidators or donate for tax benefits. Stock value: $${current_stock_value.toFixed(
            2
          )}`;
        } else {
          recommendation = `High priority liquidation. Bundle with popular items or create clearance promotion. Suggested ${suggested_discount_percentage}% discount.`;
        }
        break;

      case "dead_stock":
        if (current_stock_value > 1000) {
          recommendation = `Medium priority. Consider flash sale or seasonal promotion. High-value item - negotiate with suppliers for return/exchange.`;
        } else {
          recommendation = `Create clearance bundle or employee purchase program. Suggested ${suggested_discount_percentage}% discount.`;
        }
        break;

      case "slow_moving":
        recommendation = `Monitor closely. Consider small discount promotion or improved product placement. Review marketing strategy.`;
        break;

      default:
        recommendation = "Continue monitoring sales performance.";
    }

    return recommendation;
  }

  /**
   * Get dead stock analysis for a store
   */
  static async getStoreDeadStockAnalysis(
    storeId,
    analysisDate = null,
    classification = null
  ) {
    let query = `
      SELECT 
        dsa.*,
        p.product_name,
        p.sku,
        p.unit_cost,
        p.selling_price,
        p.category,
        i.current_stock
      FROM dead_stock_analysis dsa
      JOIN products p ON dsa.product_id = p.product_id
      LEFT JOIN inventory i ON p.product_id = i.product_id
      WHERE p.store_id = $1
    `;
    const params = [storeId];

    if (analysisDate) {
      query += ` AND dsa.analysis_date = $${params.length + 1}`;
      params.push(analysisDate);
    } else {
      // Get the latest analysis by default
      query += ` AND dsa.analysis_date = (
        SELECT MAX(analysis_date) 
        FROM dead_stock_analysis dsa2 
        JOIN products p2 ON dsa2.product_id = p2.product_id 
        WHERE p2.store_id = $1
      )`;
    }

    if (classification) {
      query += ` AND dsa.dead_stock_classification = $${params.length + 1}`;
      params.push(classification);
    }

    query += ` ORDER BY dsa.liquidation_priority DESC, dsa.current_stock_value DESC`;

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get dead stock trends over time
   */
  static async getDeadStockTrends(storeId, startDate = null, endDate = null) {
    let query = `
      SELECT 
        dsa.analysis_date,
        dsa.dead_stock_classification,
        COUNT(*) as product_count,
        SUM(dsa.current_stock_value) as total_value,
        AVG(dsa.velocity_score) as avg_velocity_score,
        AVG(dsa.days_without_sale) as avg_days_without_sale
      FROM dead_stock_analysis dsa
      JOIN products p ON dsa.product_id = p.product_id
      WHERE p.store_id = $1
    `;
    const params = [storeId];

    if (startDate) {
      query += ` AND dsa.analysis_date >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND dsa.analysis_date <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += ` GROUP BY dsa.analysis_date, dsa.dead_stock_classification
               ORDER BY dsa.analysis_date DESC, dsa.dead_stock_classification`;

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get liquidation impact analysis
   */
  static async getLiquidationImpactAnalysis(storeId, analysisDate = null) {
    let query = `
      SELECT 
        dsa.dead_stock_classification,
        COUNT(*) as product_count,
        SUM(dsa.current_stock_value) as total_current_value,
        SUM(dsa.estimated_recovery_value) as total_estimated_recovery,
        SUM(dsa.current_stock_value - dsa.estimated_recovery_value) as total_potential_loss,
        AVG(dsa.suggested_discount_percentage) as avg_discount_percentage,
        AVG(dsa.liquidation_priority) as avg_priority
      FROM dead_stock_analysis dsa
      JOIN products p ON dsa.product_id = p.product_id
      WHERE p.store_id = $1
    `;
    const params = [storeId];

    if (analysisDate) {
      query += ` AND dsa.analysis_date = $${params.length + 1}`;
      params.push(analysisDate);
    } else {
      query += ` AND dsa.analysis_date = (
        SELECT MAX(analysis_date) 
        FROM dead_stock_analysis dsa2 
        JOIN products p2 ON dsa2.product_id = p2.product_id 
        WHERE p2.store_id = $1
      )`;
    }

    query += ` GROUP BY dsa.dead_stock_classification
               ORDER BY total_current_value DESC`;

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get products ready for immediate liquidation
   */
  static async getImmediateLiquidationCandidates(
    storeId,
    priorityThreshold = 7,
    valueThreshold = 100
  ) {
    const result = await db.query(
      `SELECT 
        dsa.*,
        p.product_name,
        p.sku,
        p.unit_cost,
        p.selling_price,
        p.category,
        i.current_stock
      FROM dead_stock_analysis dsa
      JOIN products p ON dsa.product_id = p.product_id
      LEFT JOIN inventory i ON p.product_id = i.product_id
      WHERE p.store_id = $1
        AND dsa.analysis_date = (
          SELECT MAX(analysis_date) 
          FROM dead_stock_analysis dsa2 
          JOIN products p2 ON dsa2.product_id = p2.product_id 
          WHERE p2.store_id = $1
        )
        AND dsa.liquidation_priority >= $2
        AND dsa.current_stock_value >= $3
        AND dsa.dead_stock_classification IN ('dead_stock', 'obsolete')
      ORDER BY dsa.liquidation_priority DESC, dsa.current_stock_value DESC`,
      [storeId, priorityThreshold, valueThreshold]
    );

    return result.rows;
  }

  /**
   * Update analysis record
   */
  static async update(analysisId, updates) {
    const setClause = [];
    const params = [];
    let paramIndex = 1;

    Object.keys(updates).forEach((key) => {
      if (updates[key] !== undefined) {
        const columnName = key.replace(/([A-Z])/g, "_$1").toLowerCase();
        setClause.push(`${columnName} = $${paramIndex}`);
        params.push(updates[key]);
        paramIndex++;
      }
    });

    if (setClause.length === 0) {
      throw new Error("No updates provided");
    }

    params.push(analysisId);
    const query = `
      UPDATE dead_stock_analysis 
      SET ${setClause.join(", ")}, created_at = CURRENT_TIMESTAMP
      WHERE analysis_id = $${paramIndex}
      RETURNING *
    `;

    const result = await db.query(query, params);
    return result.rows[0];
  }

  /**
   * Delete old analysis records
   */
  static async deleteOldAnalysis(daysToKeep = 180) {
    const result = await db.query(
      `DELETE FROM dead_stock_analysis 
       WHERE analysis_date < CURRENT_DATE - INTERVAL '${daysToKeep} days'
       RETURNING analysis_id`
    );

    return result.rows;
  }

  /**
   * Get summary statistics for dead stock
   */
  static async getSummaryStats(storeId, analysisDate = null) {
    let query = `
      SELECT 
        COUNT(*) as total_products_analyzed,
        SUM(dsa.current_stock_value) as total_stock_value,
        SUM(dsa.estimated_recovery_value) as total_estimated_recovery,
        SUM(dsa.current_stock_value - dsa.estimated_recovery_value) as total_potential_loss,
        AVG(dsa.velocity_score) as avg_velocity_score,
        COUNT(CASE WHEN dsa.dead_stock_classification = 'slow_moving' THEN 1 END) as slow_moving_count,
        COUNT(CASE WHEN dsa.dead_stock_classification = 'dead_stock' THEN 1 END) as dead_stock_count,
        COUNT(CASE WHEN dsa.dead_stock_classification = 'obsolete' THEN 1 END) as obsolete_count
      FROM dead_stock_analysis dsa
      JOIN products p ON dsa.product_id = p.product_id
      WHERE p.store_id = $1
    `;
    const params = [storeId];

    if (analysisDate) {
      query += ` AND dsa.analysis_date = $${params.length + 1}`;
      params.push(analysisDate);
    } else {
      query += ` AND dsa.analysis_date = (
        SELECT MAX(analysis_date) 
        FROM dead_stock_analysis dsa2 
        JOIN products p2 ON dsa2.product_id = p2.product_id 
        WHERE p2.store_id = $1
      )`;
    }

    const result = await db.query(query, params);
    return result.rows[0];
  }
}

module.exports = DeadStockAnalysis;
