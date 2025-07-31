const db = require("../../config/database");
const { v4: uuidv4 } = require("uuid");

class ExternalFactors {
  /**
   * Create a new external factor
   */
  static async create({
    factorType,
    factorName,
    factorDate,
    impactCoefficient = 1.0,
    categoryAffected = null,
    productId = null,
    storeId = null,
    isActive = true,
  }) {
    const factorId = uuidv4();

    const result = await db.query(
      `INSERT INTO external_factors (
        factor_id, factor_type, factor_name, factor_date, impact_coefficient,
        category_affected, product_id, store_id, is_active
      ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`,
      [
        factorId,
        factorType,
        factorName,
        factorDate,
        impactCoefficient,
        categoryAffected,
        productId,
        storeId,
        isActive,
      ]
    );

    return result.rows[0];
  }

  /**
   * Get external factors for a specific date range
   */
  static async getFactorsForDateRange(
    startDate,
    endDate,
    storeId = null,
    factorType = null
  ) {
    let query = `
      SELECT * FROM external_factors
      WHERE factor_date >= $1 AND factor_date <= $2 AND is_active = true
    `;
    const params = [startDate, endDate];

    if (storeId) {
      query += ` AND (store_id = $${params.length + 1} OR store_id IS NULL)`;
      params.push(storeId);
    }

    if (factorType) {
      query += ` AND factor_type = $${params.length + 1}`;
      params.push(factorType);
    }

    query += ` ORDER BY factor_date, factor_type`;

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get factors affecting a specific product
   */
  static async getFactorsForProduct(
    productId,
    startDate = null,
    endDate = null
  ) {
    let query = `
      SELECT ef.* FROM external_factors ef
      JOIN products p ON (ef.product_id = p.product_id OR ef.store_id = p.store_id OR ef.product_id IS NULL)
      WHERE p.product_id = $1 AND ef.is_active = true
    `;
    const params = [productId];

    if (startDate) {
      query += ` AND ef.factor_date >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND ef.factor_date <= $${params.length + 1}`;
      params.push(endDate);
    }

    // Also include category-based factors
    query += ` OR (ef.category_affected = p.category AND ef.is_active = true`;

    if (startDate) {
      query += ` AND ef.factor_date >= $${
        startDate ? params.indexOf(startDate) + 1 : params.length + 1
      }`;
      if (!params.includes(startDate)) params.push(startDate);
    }

    if (endDate) {
      query += ` AND ef.factor_date <= $${
        endDate ? params.indexOf(endDate) + 1 : params.length + 1
      }`;
      if (!params.includes(endDate)) params.push(endDate);
    }

    query += `)`;
    query += ` ORDER BY ef.factor_date, ef.factor_type`;

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Create common holiday factors for a year
   */
  static async createHolidayFactors(year, storeId) {
    const holidays = [
      {
        name: "New Year's Day",
        date: `${year}-01-01`,
        impact: 0.8,
        type: "holiday",
      },
      {
        name: "Valentine's Day",
        date: `${year}-02-14`,
        impact: 1.5,
        type: "holiday",
      },
      {
        name: "Easter",
        date: this.getEasterDate(year),
        impact: 1.2,
        type: "holiday",
      },
      {
        name: "Mother's Day",
        date: this.getMothersDay(year),
        impact: 1.4,
        type: "holiday",
      },
      {
        name: "Father's Day",
        date: this.getFathersDay(year),
        impact: 1.3,
        type: "holiday",
      },
      {
        name: "Independence Day",
        date: `${year}-07-04`,
        impact: 1.1,
        type: "holiday",
      },
      {
        name: "Back to School",
        date: `${year}-08-15`,
        impact: 1.6,
        type: "event",
      },
      {
        name: "Halloween",
        date: `${year}-10-31`,
        impact: 1.3,
        type: "holiday",
      },
      {
        name: "Black Friday",
        date: this.getBlackFriday(year),
        impact: 2.5,
        type: "event",
      },
      {
        name: "Cyber Monday",
        date: this.getCyberMonday(year),
        impact: 2.0,
        type: "event",
      },
      {
        name: "Christmas Week",
        date: `${year}-12-25`,
        impact: 3.0,
        type: "holiday",
      },
    ];

    const factorPromises = holidays.map((holiday) =>
      this.create({
        factorType: holiday.type,
        factorName: holiday.name,
        factorDate: holiday.date,
        impactCoefficient: holiday.impact,
        storeId: storeId,
      })
    );

    const results = await Promise.all(factorPromises);
    return results;
  }

  /**
   * Get seasonal factors for forecasting
   */
  static async getSeasonalFactors(storeId, category = null) {
    let query = `
      SELECT 
        EXTRACT(MONTH FROM factor_date) as month,
        EXTRACT(QUARTER FROM factor_date) as quarter,
        factor_type,
        AVG(impact_coefficient) as avg_impact,
        COUNT(*) as factor_count
      FROM external_factors
      WHERE store_id = $1 AND is_active = true
    `;
    const params = [storeId];

    if (category) {
      query += ` AND (category_affected = $${
        params.length + 1
      } OR category_affected IS NULL)`;
      params.push(category);
    }

    query += ` GROUP BY EXTRACT(MONTH FROM factor_date), EXTRACT(QUARTER FROM factor_date), factor_type
               ORDER BY month, factor_type`;

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Update external factor
   */
  static async update(factorId, updates) {
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

    params.push(factorId);
    const query = `
      UPDATE external_factors 
      SET ${setClause.join(", ")}, created_at = CURRENT_TIMESTAMP
      WHERE factor_id = $${paramIndex}
      RETURNING *
    `;

    const result = await db.query(query, params);
    return result.rows[0];
  }

  /**
   * Deactivate external factor
   */
  static async deactivate(factorId) {
    const result = await db.query(
      `UPDATE external_factors 
       SET is_active = false, created_at = CURRENT_TIMESTAMP
       WHERE factor_id = $1
       RETURNING *`,
      [factorId]
    );

    return result.rows[0];
  }

  /**
   * Get factor impact analysis
   */
  static async getFactorImpactAnalysis(storeId, startDate, endDate) {
    const query = `
      SELECT 
        ef.factor_type,
        ef.factor_name,
        ef.factor_date,
        ef.impact_coefficient,
        COUNT(s.sale_id) as sales_on_date,
        SUM(s.quantity_sold) as total_quantity_sold,
        AVG(s.quantity_sold) as avg_quantity_per_sale
      FROM external_factors ef
      LEFT JOIN products p ON (ef.product_id = p.product_id OR ef.store_id = p.store_id)
      LEFT JOIN sales s ON p.product_id = s.product_id AND DATE(s.sale_date) = ef.factor_date
      WHERE ef.store_id = $1 
        AND ef.factor_date >= $2 
        AND ef.factor_date <= $3
        AND ef.is_active = true
      GROUP BY ef.factor_id, ef.factor_type, ef.factor_name, ef.factor_date, ef.impact_coefficient
      ORDER BY ef.factor_date DESC
    `;

    const result = await db.query(query, [storeId, startDate, endDate]);
    return result.rows;
  }

  /**
   * Helper methods for calculating holiday dates
   */
  static getEasterDate(year) {
    // Simplified Easter calculation (can be improved with proper algorithm)
    const easterDates = {
      2024: "2024-03-31",
      2025: "2025-04-20",
      2026: "2026-04-05",
      2027: "2027-03-28",
    };
    return easterDates[year] || `${year}-04-01`;
  }

  static getMothersDay(year) {
    // Second Sunday in May
    return `${year}-05-14`; // Approximation
  }

  static getFathersDay(year) {
    // Third Sunday in June
    return `${year}-06-18`; // Approximation
  }

  static getBlackFriday(year) {
    // Friday after Thanksgiving (4th Thursday in November)
    return `${year}-11-29`; // Approximation
  }

  static getCyberMonday(year) {
    // Monday after Black Friday
    return `${year}-12-02`; // Approximation
  }

  /**
   * Delete old factors
   */
  static async deleteOldFactors(daysToKeep = 730) {
    const result = await db.query(
      `DELETE FROM external_factors 
       WHERE factor_date < CURRENT_DATE - INTERVAL '${daysToKeep} days'
       RETURNING factor_id`
    );

    return result.rows;
  }

  /**
   * Bulk create factors
   */
  static async bulkCreate(factorsData) {
    if (!factorsData || factorsData.length === 0) {
      return [];
    }

    const values = factorsData
      .map(
        (factor) =>
          `('${uuidv4()}', '${factor.factorType}', '${factor.factorName}', '${
            factor.factorDate
          }', ${factor.impactCoefficient || 1.0}, ${
            factor.categoryAffected ? `'${factor.categoryAffected}'` : "NULL"
          }, ${factor.productId ? `'${factor.productId}'` : "NULL"}, ${
            factor.storeId ? `'${factor.storeId}'` : "NULL"
          }, ${factor.isActive !== false})`
      )
      .join(",");

    const query = `
      INSERT INTO external_factors (
        factor_id, factor_type, factor_name, factor_date, impact_coefficient,
        category_affected, product_id, store_id, is_active
      ) 
      VALUES ${values}
      RETURNING *
    `;

    const result = await db.query(query);
    return result.rows;
  }
}

module.exports = ExternalFactors;
