const db = require("../../config/database");
const { v4: uuidv4 } = require("uuid");

class Forecast {
  static async create({
    productId,
    forecastDate,
    predictedDemand,
    confidenceLevel = "medium",
  }) {
    const forecastId = uuidv4();

    const result = await db.query(
      `INSERT INTO forecasts (forecast_id, product_id, forecast_date, predicted_demand, confidence_level) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (product_id, forecast_date) 
       DO UPDATE SET predicted_demand = $4, confidence_level = $5, created_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [forecastId, productId, forecastDate, predictedDemand, confidenceLevel]
    );

    return result.rows[0];
  }

  static async bulkCreate(forecastsData) {
    const values = forecastsData
      .map(
        (forecast) =>
          `('${uuidv4()}', '${forecast.productId}', '${
            forecast.forecastDate
          }', ${forecast.predictedDemand}, '${
            forecast.confidenceLevel || "medium"
          }')`
      )
      .join(",");

    const query = `
      INSERT INTO forecasts (forecast_id, product_id, forecast_date, predicted_demand, confidence_level) 
      VALUES ${values}
      ON CONFLICT (product_id, forecast_date) 
      DO UPDATE SET 
        predicted_demand = EXCLUDED.predicted_demand,
        confidence_level = EXCLUDED.confidence_level,
        created_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await db.query(query);
    return result.rows;
  }

  static async findByProductId(productId, startDate = null, endDate = null) {
    let query = `
      SELECT * FROM forecasts 
      WHERE product_id = $1
    `;
    const params = [productId];

    if (startDate) {
      query += ` AND forecast_date >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND forecast_date <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += " ORDER BY forecast_date";

    const result = await db.query(query, params);
    return result.rows;
  }

  static async getLatestForecasts(storeId, daysAhead = 30) {
    const result = await db.query(
      `SELECT 
        f.*,
        p.product_name,
        p.sku,
        i.current_stock
      FROM forecasts f
      JOIN products p ON f.product_id = p.product_id
      LEFT JOIN inventory i ON p.product_id = i.product_id
      WHERE p.store_id = $1
        AND f.forecast_date >= CURRENT_DATE
        AND f.forecast_date <= CURRENT_DATE + INTERVAL '${daysAhead} days'
      ORDER BY f.forecast_date, p.product_name`,
      [storeId]
    );

    return result.rows;
  }

  static async getReorderSuggestions(storeId, leadTimeDays = 7) {
    const result = await db.query(
      `WITH future_demand AS (
        SELECT 
          f.product_id,
          SUM(f.predicted_demand) as total_predicted_demand
        FROM forecasts f
        JOIN products p ON f.product_id = p.product_id
        WHERE p.store_id = $1
          AND f.forecast_date >= CURRENT_DATE
          AND f.forecast_date <= CURRENT_DATE + INTERVAL '${leadTimeDays} days'
        GROUP BY f.product_id
      )
      SELECT 
        p.product_id,
        p.product_name,
        p.sku,
        i.current_stock,
        fd.total_predicted_demand,
        GREATEST(0, CEIL(fd.total_predicted_demand - COALESCE(i.current_stock, 0))) as suggested_reorder_amount
      FROM products p
      JOIN future_demand fd ON p.product_id = fd.product_id
      LEFT JOIN inventory i ON p.product_id = i.product_id
      WHERE p.store_id = $1
        AND fd.total_predicted_demand > COALESCE(i.current_stock, 0)
      ORDER BY suggested_reorder_amount DESC`,
      [storeId]
    );

    return result.rows;
  }

  static async deleteOldForecasts(daysToKeep = 90) {
    const result = await db.query(
      `DELETE FROM forecasts 
       WHERE forecast_date < CURRENT_DATE - INTERVAL '${daysToKeep} days'
       RETURNING forecast_id`
    );

    return result.rows;
  }

  /**
   * Create forecast with accuracy tracking
   */
  static async createWithAccuracy({
    productId,
    forecastDate,
    predictedDemand,
    confidenceLevel = "medium",
    modelUsed = "prophet",
    upperBound = null,
    lowerBound = null,
  }) {
    const forecastId = uuidv4();

    const result = await db.query(
      `INSERT INTO forecasts (forecast_id, product_id, forecast_date, predicted_demand, confidence_level, model_used, upper_bound, lower_bound) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       ON CONFLICT (product_id, forecast_date) 
       DO UPDATE SET 
         predicted_demand = $4, 
         confidence_level = $5, 
         model_used = $6, 
         upper_bound = $7, 
         lower_bound = $8,
         created_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        forecastId,
        productId,
        forecastDate,
        predictedDemand,
        confidenceLevel,
        modelUsed,
        upperBound,
        lowerBound,
      ]
    );

    return result.rows[0];
  }

  /**
   * Get forecasts with accuracy data
   */
  static async getForecastsWithAccuracy(
    storeId,
    startDate = null,
    endDate = null
  ) {
    let query = `
      SELECT 
        f.*,
        p.product_name,
        p.sku,
        fa.actual_demand,
        fa.accuracy_percentage,
        fa.absolute_error,
        fa.percentage_error
      FROM forecasts f
      JOIN products p ON f.product_id = p.product_id
      LEFT JOIN forecast_accuracy fa ON f.product_id = fa.product_id AND f.forecast_date = fa.forecast_date
      WHERE p.store_id = $1
    `;
    const params = [storeId];

    if (startDate) {
      query += ` AND f.forecast_date >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND f.forecast_date <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += " ORDER BY f.forecast_date DESC, p.product_name";

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get multi-step ahead forecasts (1, 4, 12 weeks)
   */
  static async getMultiStepForecasts(storeId, productId = null) {
    let query = `
      SELECT 
        f.*,
        p.product_name,
        p.sku,
        i.current_stock,
        CASE 
          WHEN f.forecast_date <= CURRENT_DATE + INTERVAL '7 days' THEN '1_week'
          WHEN f.forecast_date <= CURRENT_DATE + INTERVAL '28 days' THEN '4_week'
          WHEN f.forecast_date <= CURRENT_DATE + INTERVAL '84 days' THEN '12_week'
          ELSE 'long_term'
        END as forecast_horizon
      FROM forecasts f
      JOIN products p ON f.product_id = p.product_id
      LEFT JOIN inventory i ON p.product_id = i.product_id
      WHERE p.store_id = $1
        AND f.forecast_date >= CURRENT_DATE
        AND f.forecast_date <= CURRENT_DATE + INTERVAL '84 days'
    `;
    const params = [storeId];

    if (productId) {
      query += ` AND f.product_id = $${params.length + 1}`;
      params.push(productId);
    }

    query += " ORDER BY f.product_id, f.forecast_date";

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get forecast confidence analysis
   */
  static async getForecastConfidenceAnalysis(storeId, timePeriod = "monthly") {
    let dateGrouping;
    switch (timePeriod) {
      case "daily":
        dateGrouping = "DATE(f.forecast_date)";
        break;
      case "weekly":
        dateGrouping = "DATE_TRUNC('week', f.forecast_date)";
        break;
      case "monthly":
        dateGrouping = "DATE_TRUNC('month', f.forecast_date)";
        break;
      default:
        dateGrouping = "DATE_TRUNC('month', f.forecast_date)";
    }

    const query = `
      SELECT 
        ${dateGrouping} as period,
        f.confidence_level,
        COUNT(*) as forecast_count,
        AVG(f.predicted_demand) as avg_predicted_demand,
        AVG(COALESCE(fa.accuracy_percentage, 0)) as avg_accuracy,
        COUNT(fa.accuracy_id) as verified_forecasts
      FROM forecasts f
      JOIN products p ON f.product_id = p.product_id
      LEFT JOIN forecast_accuracy fa ON f.product_id = fa.product_id AND f.forecast_date = fa.forecast_date
      WHERE p.store_id = $1
        AND f.forecast_date >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY ${dateGrouping}, f.confidence_level
      ORDER BY period DESC, f.confidence_level
    `;

    const result = await db.query(query, [storeId]);
    return result.rows;
  }

  /**
   * Update forecast accuracy when actual sales data becomes available
   */
  static async updateForecastAccuracy(productId, forecastDate, actualDemand) {
    // First get the forecast
    const forecast = await db.query(
      `SELECT * FROM forecasts WHERE product_id = $1 AND forecast_date = $2`,
      [productId, forecastDate]
    );

    if (forecast.rows.length === 0) {
      throw new Error("Forecast not found");
    }

    const forecastData = forecast.rows[0];

    // Create or update forecast accuracy record
    const ForecastAccuracy = require("./ForecastAccuracy");
    return await ForecastAccuracy.create({
      productId,
      forecastDate,
      predictedDemand: forecastData.predicted_demand,
      actualDemand,
      modelUsed: forecastData.model_used || "prophet",
      confidenceLevel: forecastData.confidence_level,
    });
  }

  /**
   * Get forecasts requiring accuracy updates
   */
  static async getForecastsNeedingAccuracyUpdate(storeId, daysBack = 7) {
    const query = `
      SELECT 
        f.*,
        p.product_name,
        p.sku,
        COALESCE(SUM(s.quantity_sold), 0) as actual_demand
      FROM forecasts f
      JOIN products p ON f.product_id = p.product_id
      LEFT JOIN sales s ON f.product_id = s.product_id 
        AND DATE(s.sale_date) = f.forecast_date
      LEFT JOIN forecast_accuracy fa ON f.product_id = fa.product_id 
        AND f.forecast_date = fa.forecast_date
      WHERE p.store_id = $1
        AND f.forecast_date >= CURRENT_DATE - INTERVAL '${daysBack} days'
        AND f.forecast_date < CURRENT_DATE
        AND fa.accuracy_id IS NULL
      GROUP BY f.forecast_id, f.product_id, f.forecast_date, f.predicted_demand, 
               f.confidence_level, f.created_at, p.product_name, p.sku
      ORDER BY f.forecast_date DESC
    `;

    const result = await db.query(query, [storeId]);
    return result.rows;
  }
}

module.exports = Forecast;
