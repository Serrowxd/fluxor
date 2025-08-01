const db = require("../../config/database");
const { v4: uuidv4 } = require("uuid");

class ForecastAccuracy {
  /**
   * Create a new forecast accuracy record
   */
  static async create({
    productId,
    forecastDate,
    predictedDemand,
    actualDemand,
    modelUsed = "prophet",
    confidenceLevel = "medium",
  }) {
    const accuracyId = uuidv4();

    const result = await db.query(
      `INSERT INTO forecast_accuracy (accuracy_id, product_id, forecast_date, predicted_demand, actual_demand, model_used, confidence_level) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       ON CONFLICT (product_id, forecast_date) 
       DO UPDATE SET 
         predicted_demand = $4, 
         actual_demand = $5, 
         model_used = $6, 
         confidence_level = $7,
         created_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        accuracyId,
        productId,
        forecastDate,
        predictedDemand,
        actualDemand,
        modelUsed,
        confidenceLevel,
      ]
    );

    return result.rows[0];
  }

  /**
   * Bulk create forecast accuracy records
   */
  static async bulkCreate(accuracyData) {
    if (!accuracyData || accuracyData.length === 0) {
      return [];
    }

    const values = accuracyData
      .map(
        (accuracy) =>
          `('${uuidv4()}', '${accuracy.productId}', '${
            accuracy.forecastDate
          }', ${accuracy.predictedDemand}, ${accuracy.actualDemand}, '${
            accuracy.modelUsed || "prophet"
          }', '${accuracy.confidenceLevel || "medium"}')`
      )
      .join(",");

    const query = `
      INSERT INTO forecast_accuracy (accuracy_id, product_id, forecast_date, predicted_demand, actual_demand, model_used, confidence_level) 
      VALUES ${values}
      ON CONFLICT (product_id, forecast_date) 
      DO UPDATE SET 
        predicted_demand = EXCLUDED.predicted_demand,
        actual_demand = EXCLUDED.actual_demand,
        model_used = EXCLUDED.model_used,
        confidence_level = EXCLUDED.confidence_level,
        created_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await db.query(query);
    return result.rows;
  }

  /**
   * Get forecast accuracy for a specific product
   */
  static async findByProductId(productId, startDate = null, endDate = null) {
    let query = `
      SELECT 
        fa.*,
        p.product_name,
        p.sku
      FROM forecast_accuracy fa
      JOIN products p ON fa.product_id = p.product_id
      WHERE fa.product_id = $1
    `;
    const params = [productId];

    if (startDate) {
      query += ` AND fa.forecast_date >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND fa.forecast_date <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += " ORDER BY fa.forecast_date DESC";

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get accuracy metrics for a product over a time period
   */
  static async getAccuracyMetrics(
    productId,
    timePeriod = "monthly",
    startDate = null,
    endDate = null
  ) {
    let dateGrouping;
    switch (timePeriod) {
      case "daily":
        dateGrouping = "DATE(fa.forecast_date)";
        break;
      case "weekly":
        dateGrouping = "DATE_TRUNC('week', fa.forecast_date)";
        break;
      case "monthly":
        dateGrouping = "DATE_TRUNC('month', fa.forecast_date)";
        break;
      default:
        dateGrouping = "DATE_TRUNC('month', fa.forecast_date)";
    }

    let query = `
      SELECT 
        ${dateGrouping} as period,
        COUNT(*) as total_forecasts,
        AVG(fa.accuracy_percentage) as avg_accuracy,
        AVG(fa.absolute_error) as mean_absolute_error,
        AVG(ABS(fa.percentage_error)) as mean_absolute_percentage_error,
        SQRT(AVG(POWER(fa.absolute_error, 2))) as root_mean_square_error,
        AVG(fa.percentage_error) as forecast_bias,
        MIN(fa.accuracy_percentage) as min_accuracy,
        MAX(fa.accuracy_percentage) as max_accuracy,
        STDDEV(fa.accuracy_percentage) as accuracy_std_dev
      FROM forecast_accuracy fa
      WHERE fa.product_id = $1
    `;
    const params = [productId];

    if (startDate) {
      query += ` AND fa.forecast_date >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND fa.forecast_date <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += ` GROUP BY ${dateGrouping} ORDER BY period DESC`;

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get accuracy comparison by model type
   */
  static async getModelComparison(
    productId = null,
    startDate = null,
    endDate = null
  ) {
    let query = `
      SELECT 
        fa.model_used,
        COUNT(*) as total_forecasts,
        AVG(fa.accuracy_percentage) as avg_accuracy,
        AVG(fa.absolute_error) as mean_absolute_error,
        AVG(ABS(fa.percentage_error)) as mean_absolute_percentage_error,
        SQRT(AVG(POWER(fa.absolute_error, 2))) as root_mean_square_error,
        AVG(fa.percentage_error) as forecast_bias
      FROM forecast_accuracy fa
    `;
    const params = [];
    const conditions = [];

    if (productId) {
      conditions.push(`fa.product_id = $${params.length + 1}`);
      params.push(productId);
    }

    if (startDate) {
      conditions.push(`fa.forecast_date >= $${params.length + 1}`);
      params.push(startDate);
    }

    if (endDate) {
      conditions.push(`fa.forecast_date <= $${params.length + 1}`);
      params.push(endDate);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += ` GROUP BY fa.model_used ORDER BY avg_accuracy DESC`;

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get store-wide accuracy metrics
   */
  static async getStoreAccuracyMetrics(
    storeId,
    timePeriod = "monthly",
    startDate = null,
    endDate = null
  ) {
    let dateGrouping;
    switch (timePeriod) {
      case "daily":
        dateGrouping = "DATE(fa.forecast_date)";
        break;
      case "weekly":
        dateGrouping = "DATE_TRUNC('week', fa.forecast_date)";
        break;
      case "monthly":
        dateGrouping = "DATE_TRUNC('month', fa.forecast_date)";
        break;
      default:
        dateGrouping = "DATE_TRUNC('month', fa.forecast_date)";
    }

    let query = `
      SELECT 
        ${dateGrouping} as period,
        COUNT(*) as total_forecasts,
        AVG(fa.accuracy_percentage) as avg_accuracy,
        AVG(fa.absolute_error) as mean_absolute_error,
        AVG(ABS(fa.percentage_error)) as mean_absolute_percentage_error,
        SQRT(AVG(POWER(fa.absolute_error, 2))) as root_mean_square_error,
        AVG(fa.percentage_error) as forecast_bias,
        COUNT(DISTINCT fa.product_id) as products_analyzed
      FROM forecast_accuracy fa
      JOIN products p ON fa.product_id = p.product_id
      WHERE p.store_id = $1
    `;
    const params = [storeId];

    if (startDate) {
      query += ` AND fa.forecast_date >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND fa.forecast_date <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += ` GROUP BY ${dateGrouping} ORDER BY period DESC`;

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get products with low forecast accuracy that need attention
   */
  static async getProductsNeedingAttention(
    storeId,
    accuracyThreshold = 70,
    minForecasts = 5
  ) {
    const result = await db.query(
      `SELECT 
        p.product_id,
        p.product_name,
        p.sku,
        COUNT(fa.accuracy_id) as total_forecasts,
        AVG(fa.accuracy_percentage) as avg_accuracy,
        AVG(fa.absolute_error) as mean_absolute_error,
        AVG(ABS(fa.percentage_error)) as mean_absolute_percentage_error,
        fa.model_used,
        MAX(fa.forecast_date) as last_forecast_date
      FROM products p
      JOIN forecast_accuracy fa ON p.product_id = fa.product_id
      WHERE p.store_id = $1
        AND fa.forecast_date >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY p.product_id, p.product_name, p.sku, fa.model_used
      HAVING COUNT(fa.accuracy_id) >= $3 
        AND AVG(fa.accuracy_percentage) < $2
      ORDER BY avg_accuracy ASC, total_forecasts DESC`,
      [storeId, accuracyThreshold, minForecasts]
    );

    return result.rows;
  }

  /**
   * Update forecast accuracy with actual sales data
   */
  static async updateWithActualSales(productId, forecastDate, actualDemand) {
    const result = await db.query(
      `UPDATE forecast_accuracy 
       SET actual_demand = $3, created_at = CURRENT_TIMESTAMP
       WHERE product_id = $1 AND forecast_date = $2
       RETURNING *`,
      [productId, forecastDate, actualDemand]
    );

    return result.rows[0];
  }

  /**
   * Delete old accuracy records
   */
  static async deleteOldRecords(daysToKeep = 365) {
    const result = await db.query(
      `DELETE FROM forecast_accuracy 
       WHERE forecast_date < CURRENT_DATE - INTERVAL '${daysToKeep} days'
       RETURNING accuracy_id`
    );

    return result.rows;
  }

  // Method aliases for test compatibility
  static async recordAccuracy(data) {
    return this.create(data);
  }
}

module.exports = ForecastAccuracy;
