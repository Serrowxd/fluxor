const db = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

class Sale {
  static async create({ productId, quantitySold, saleDate }) {
    const saleId = uuidv4();
    
    const result = await db.query(
      `INSERT INTO sales (sale_id, product_id, quantity_sold, sale_date) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [saleId, productId, quantitySold, saleDate]
    );
    
    return result.rows[0];
  }

  static async bulkCreate(salesData) {
    const values = salesData.map(sale => 
      `('${uuidv4()}', '${sale.productId}', ${sale.quantitySold}, '${sale.saleDate.toISOString()}')`
    ).join(',');

    const query = `
      INSERT INTO sales (sale_id, product_id, quantity_sold, sale_date) 
      VALUES ${values}
      RETURNING *
    `;

    const result = await db.query(query);
    return result.rows;
  }

  static async findByProductId(productId, startDate = null, endDate = null) {
    let query = `
      SELECT * FROM sales 
      WHERE product_id = $1
    `;
    const params = [productId];

    if (startDate) {
      query += ` AND sale_date >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND sale_date <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += ' ORDER BY sale_date DESC';

    const result = await db.query(query, params);
    return result.rows;
  }

  static async getAggregatedSales(productId, groupBy = 'day', startDate = null, endDate = null) {
    let dateFormat;
    switch (groupBy) {
      case 'day':
        dateFormat = 'YYYY-MM-DD';
        break;
      case 'week':
        dateFormat = 'YYYY-IW';
        break;
      case 'month':
        dateFormat = 'YYYY-MM';
        break;
      default:
        dateFormat = 'YYYY-MM-DD';
    }

    let query = `
      SELECT 
        TO_CHAR(sale_date, '${dateFormat}') as period,
        SUM(quantity_sold) as total_quantity,
        COUNT(*) as transaction_count
      FROM sales 
      WHERE product_id = $1
    `;
    const params = [productId];

    if (startDate) {
      query += ` AND sale_date >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND sale_date <= $${params.length + 1}`;
      params.push(endDate);
    }

    query += ` GROUP BY period ORDER BY period`;

    const result = await db.query(query, params);
    return result.rows;
  }

  static async getTotalSales(storeId, startDate = null, endDate = null) {
    let query = `
      SELECT 
        p.product_id,
        p.product_name,
        p.sku,
        SUM(s.quantity_sold) as total_quantity,
        COUNT(s.sale_id) as transaction_count
      FROM products p
      LEFT JOIN sales s ON p.product_id = s.product_id
      WHERE p.store_id = $1
    `;
    const params = [storeId];

    if (startDate) {
      query += ` AND (s.sale_date >= $${params.length + 1} OR s.sale_date IS NULL)`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND (s.sale_date <= $${params.length + 1} OR s.sale_date IS NULL)`;
      params.push(endDate);
    }

    query += ` GROUP BY p.product_id, p.product_name, p.sku ORDER BY total_quantity DESC`;

    const result = await db.query(query, params);
    return result.rows;
  }

  static async getRecentSales(storeId, limit = 10) {
    const result = await db.query(
      `SELECT 
        s.*,
        p.product_name,
        p.sku
      FROM sales s
      JOIN products p ON s.product_id = p.product_id
      WHERE p.store_id = $1
      ORDER BY s.sale_date DESC
      LIMIT $2`,
      [storeId, limit]
    );
    
    return result.rows;
  }

  static async delete(saleId) {
    const result = await db.query(
      'DELETE FROM sales WHERE sale_id = $1 RETURNING sale_id',
      [saleId]
    );
    
    return result.rows[0];
  }

  /**
   * Get historical sales data grouped by month for seasonal pattern analysis
   */
  static async getHistoricalSalesByMonth(storeId) {
    const query = `
      SELECT 
        EXTRACT(MONTH FROM s.sale_date) as month,
        TO_CHAR(s.sale_date, 'Month') as month_name,
        AVG(s.quantity_sold) as avg_daily_sales,
        SUM(s.quantity_sold * COALESCE(p.selling_price, p.unit_cost * 1.5)) as total_revenue,
        COUNT(DISTINCT DATE(s.sale_date)) as days_with_sales,
        COUNT(DISTINCT s.product_id) as unique_products_sold
      FROM sales s
      JOIN products p ON s.product_id = p.product_id
      WHERE p.store_id = $1
        AND s.sale_date >= NOW() - INTERVAL '12 months'
      GROUP BY EXTRACT(MONTH FROM s.sale_date), TO_CHAR(s.sale_date, 'Month')
      ORDER BY month
    `;

    const result = await db.query(query, [storeId]);
    return result.rows;
  }

  /**
   * Get daily sales trends for trend analysis
   */
  static async getSalesTrends(storeId, days = 30) {
    const query = `
      SELECT 
        DATE(s.sale_date) as sale_date,
        SUM(s.quantity_sold) as total_quantity,
        SUM(s.quantity_sold * COALESCE(p.selling_price, p.unit_cost * 1.5)) as daily_revenue,
        COUNT(DISTINCT s.product_id) as unique_products,
        COUNT(s.sale_id) as transaction_count
      FROM sales s
      JOIN products p ON s.product_id = p.product_id
      WHERE p.store_id = $1
        AND s.sale_date >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE(s.sale_date)
      ORDER BY sale_date
    `;

    const result = await db.query(query, [storeId]);
    return result.rows;
  }
}

module.exports = Sale;