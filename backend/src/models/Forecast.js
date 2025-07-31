const db = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

class Forecast {
  static async create({ productId, forecastDate, predictedDemand, confidenceLevel = 'medium' }) {
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
    const values = forecastsData.map(forecast => 
      `('${uuidv4()}', '${forecast.productId}', '${forecast.forecastDate}', ${forecast.predictedDemand}, '${forecast.confidenceLevel || 'medium'}')`
    ).join(',');

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

    query += ' ORDER BY forecast_date';

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
       RETURNING forecast_id`,
    );
    
    return result.rows;
  }
}

module.exports = Forecast;