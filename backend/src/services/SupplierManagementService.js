const db = require("../../config/database");

/**
 * SupplierManagementService
 *
 * Handles all supplier-related operations including:
 * - CRUD operations for suppliers
 * - Product-supplier mapping management
 * - Supplier performance tracking
 * - Preferred supplier ranking and selection
 */
class SupplierManagementService {
  /**
   * Create a new supplier
   * @param {string} storeId - Store ID
   * @param {Object} supplierData - Supplier information
   * @returns {Promise<Object>} Created supplier
   */
  async createSupplier(storeId, supplierData) {
    try {
      const {
        supplier_name,
        contact_name,
        email,
        phone,
        address_line1,
        address_line2,
        city,
        state_province,
        postal_code,
        country,
        payment_terms,
        currency = "USD",
        tax_id,
        website,
        notes,
        preferred_supplier = false,
      } = supplierData;

      const result = await db.query(
        `
        INSERT INTO suppliers (
          store_id, supplier_name, contact_name, email, phone,
          address_line1, address_line2, city, state_province, postal_code,
          country, payment_terms, currency, tax_id, website, notes, preferred_supplier
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING *
      `,
        [
          storeId,
          supplier_name,
          contact_name,
          email,
          phone,
          address_line1,
          address_line2,
          city,
          state_province,
          postal_code,
          country,
          payment_terms,
          currency,
          tax_id,
          website,
          notes,
          preferred_supplier,
        ]
      );

      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to create supplier: ${error.message}`);
    }
  }

  /**
   * Get all suppliers for a store
   * @param {string} storeId - Store ID
   * @param {Object} filters - Optional filters
   * @returns {Promise<Array>} List of suppliers
   */
  async getSuppliers(storeId, filters = {}) {
    try {
      let query = `
        SELECT 
          s.*,
          COUNT(sp.product_id) as product_count,
          AVG(s_perf.metric_value) FILTER (WHERE s_perf.metric_type = 'quality') as avg_quality_rating,
          AVG(s_perf.metric_value) FILTER (WHERE s_perf.metric_type = 'delivery_time') as avg_delivery_time
        FROM suppliers s
        LEFT JOIN supplier_products sp ON s.supplier_id = sp.supplier_id
        LEFT JOIN supplier_performance s_perf ON s.supplier_id = s_perf.supplier_id
        WHERE s.store_id = $1
      `;

      const params = [storeId];
      let paramIndex = 1;

      if (filters.is_active !== undefined) {
        query += ` AND s.is_active = $${++paramIndex}`;
        params.push(filters.is_active);
      }

      if (filters.preferred_supplier !== undefined) {
        query += ` AND s.preferred_supplier = $${++paramIndex}`;
        params.push(filters.preferred_supplier);
      }

      if (filters.search) {
        query += ` AND (s.supplier_name ILIKE $${++paramIndex} OR s.contact_name ILIKE $${++paramIndex})`;
        params.push(`%${filters.search}%`, `%${filters.search}%`);
        paramIndex++;
      }

      query += `
        GROUP BY s.supplier_id
        ORDER BY s.preferred_supplier DESC, s.supplier_rating DESC, s.supplier_name ASC
      `;

      if (filters.limit) {
        query += ` LIMIT $${++paramIndex}`;
        params.push(filters.limit);
      }

      if (filters.offset) {
        query += ` OFFSET $${++paramIndex}`;
        params.push(filters.offset);
      }

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get suppliers: ${error.message}`);
    }
  }

  /**
   * Get supplier by ID
   * @param {string} supplierId - Supplier ID
   * @param {string} storeId - Store ID for authorization
   * @returns {Promise<Object>} Supplier details
   */
  async getSupplierById(supplierId, storeId) {
    try {
      const result = await db.query(
        `
        SELECT 
          s.*,
          COUNT(sp.product_id) as product_count,
          AVG(s_perf.metric_value) FILTER (WHERE s_perf.metric_type = 'quality') as avg_quality_rating,
          AVG(s_perf.metric_value) FILTER (WHERE s_perf.metric_type = 'delivery_time') as avg_delivery_time,
          COUNT(po.po_id) as total_purchase_orders,
          SUM(po.total_amount) as total_purchase_value
        FROM suppliers s
        LEFT JOIN supplier_products sp ON s.supplier_id = sp.supplier_id
        LEFT JOIN supplier_performance s_perf ON s.supplier_id = s_perf.supplier_id
        LEFT JOIN purchase_orders po ON s.supplier_id = po.supplier_id
        WHERE s.supplier_id = $1 AND s.store_id = $2
        GROUP BY s.supplier_id
      `,
        [supplierId, storeId]
      );

      if (result.rows.length === 0) {
        throw new Error("Supplier not found");
      }

      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to get supplier: ${error.message}`);
    }
  }

  /**
   * Update supplier information
   * @param {string} supplierId - Supplier ID
   * @param {string} storeId - Store ID for authorization
   * @param {Object} updateData - Updated supplier data
   * @returns {Promise<Object>} Updated supplier
   */
  async updateSupplier(supplierId, storeId, updateData) {
    try {
      const allowedFields = [
        "supplier_name",
        "contact_name",
        "email",
        "phone",
        "address_line1",
        "address_line2",
        "city",
        "state_province",
        "postal_code",
        "country",
        "payment_terms",
        "currency",
        "tax_id",
        "website",
        "notes",
        "is_active",
        "preferred_supplier",
      ];

      const updateFields = [];
      const values = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(updateData)) {
        if (allowedFields.includes(key)) {
          updateFields.push(`${key} = $${++paramIndex}`);
          values.push(value);
        }
      }

      if (updateFields.length === 0) {
        throw new Error("No valid fields to update");
      }

      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

      const query = `
        UPDATE suppliers 
        SET ${updateFields.join(", ")} 
        WHERE supplier_id = $1 AND store_id = $${++paramIndex}
        RETURNING *
      `;

      const result = await db.query(query, [supplierId, ...values, storeId]);

      if (result.rows.length === 0) {
        throw new Error("Supplier not found or not authorized");
      }

      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to update supplier: ${error.message}`);
    }
  }

  /**
   * Delete/deactivate a supplier
   * @param {string} supplierId - Supplier ID
   * @param {string} storeId - Store ID for authorization
   * @param {boolean} hardDelete - Whether to permanently delete or just deactivate
   * @returns {Promise<boolean>} Success status
   */
  async deleteSupplier(supplierId, storeId, hardDelete = false) {
    try {
      if (hardDelete) {
        // Check if supplier has any purchase orders
        const poCheck = await db.query(
          `
          SELECT COUNT(*) as po_count 
          FROM purchase_orders 
          WHERE supplier_id = $1
        `,
          [supplierId]
        );

        if (parseInt(poCheck.rows[0].po_count) > 0) {
          throw new Error(
            "Cannot delete supplier with existing purchase orders. Use soft delete instead."
          );
        }

        const result = await db.query(
          `
          DELETE FROM suppliers 
          WHERE supplier_id = $1 AND store_id = $2
        `,
          [supplierId, storeId]
        );

        return result.rowCount > 0;
      } else {
        // Soft delete - just deactivate
        const result = await db.query(
          `
          UPDATE suppliers 
          SET is_active = false, updated_at = CURRENT_TIMESTAMP
          WHERE supplier_id = $1 AND store_id = $2
        `,
          [supplierId, storeId]
        );

        return result.rowCount > 0;
      }
    } catch (error) {
      throw new Error(`Failed to delete supplier: ${error.message}`);
    }
  }

  /**
   * Add product-supplier mapping
   * @param {Object} mappingData - Product-supplier mapping data
   * @returns {Promise<Object>} Created mapping
   */
  async addProductSupplierMapping(mappingData) {
    try {
      const {
        supplier_id,
        product_id,
        supplier_sku,
        supplier_product_name,
        lead_time_days,
        minimum_order_quantity,
        cost_per_unit,
        bulk_pricing = [],
        is_primary_supplier = false,
      } = mappingData;

      // If this is set as primary supplier, unset others for this product
      if (is_primary_supplier) {
        await db.query(
          `
          UPDATE supplier_products 
          SET is_primary_supplier = false 
          WHERE product_id = $1
        `,
          [product_id]
        );
      }

      const result = await db.query(
        `
        INSERT INTO supplier_products (
          supplier_id, product_id, supplier_sku, supplier_product_name,
          lead_time_days, minimum_order_quantity, cost_per_unit,
          bulk_pricing, is_primary_supplier
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `,
        [
          supplier_id,
          product_id,
          supplier_sku,
          supplier_product_name,
          lead_time_days,
          minimum_order_quantity,
          cost_per_unit,
          JSON.stringify(bulk_pricing),
          is_primary_supplier,
        ]
      );

      return result.rows[0];
    } catch (error) {
      throw new Error(
        `Failed to add product-supplier mapping: ${error.message}`
      );
    }
  }

  /**
   * Get product-supplier mappings
   * @param {Object} filters - Filters for querying mappings
   * @returns {Promise<Array>} List of mappings
   */
  async getProductSupplierMappings(filters = {}) {
    try {
      let query = `
        SELECT 
          sp.*,
          s.supplier_name,
          s.email as supplier_email,
          s.preferred_supplier,
          s.supplier_rating,
          p.product_name,
          p.sku,
          p.category
        FROM supplier_products sp
        JOIN suppliers s ON sp.supplier_id = s.supplier_id
        JOIN products p ON sp.product_id = p.product_id
        WHERE 1=1
      `;

      const params = [];
      let paramIndex = 0;

      if (filters.supplier_id) {
        query += ` AND sp.supplier_id = $${++paramIndex}`;
        params.push(filters.supplier_id);
      }

      if (filters.product_id) {
        query += ` AND sp.product_id = $${++paramIndex}`;
        params.push(filters.product_id);
      }

      if (filters.store_id) {
        query += ` AND p.store_id = $${++paramIndex}`;
        params.push(filters.store_id);
      }

      if (filters.is_primary_supplier !== undefined) {
        query += ` AND sp.is_primary_supplier = $${++paramIndex}`;
        params.push(filters.is_primary_supplier);
      }

      if (filters.discontinued !== undefined) {
        query += ` AND sp.discontinued = $${++paramIndex}`;
        params.push(filters.discontinued);
      }

      query += ` ORDER BY sp.is_primary_supplier DESC, s.preferred_supplier DESC, sp.cost_per_unit ASC`;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      throw new Error(
        `Failed to get product-supplier mappings: ${error.message}`
      );
    }
  }

  /**
   * Update product-supplier mapping
   * @param {string} mappingId - Mapping ID
   * @param {Object} updateData - Updated mapping data
   * @returns {Promise<Object>} Updated mapping
   */
  async updateProductSupplierMapping(mappingId, updateData) {
    try {
      const allowedFields = [
        "supplier_sku",
        "supplier_product_name",
        "lead_time_days",
        "minimum_order_quantity",
        "cost_per_unit",
        "bulk_pricing",
        "is_primary_supplier",
        "discontinued",
      ];

      const updateFields = [];
      const values = [];
      let paramIndex = 1;

      // Handle primary supplier logic
      if (updateData.is_primary_supplier === true) {
        // Get product_id first
        const mappingResult = await db.query(
          `
          SELECT product_id FROM supplier_products WHERE supplier_product_id = $1
        `,
          [mappingId]
        );

        if (mappingResult.rows.length > 0) {
          const productId = mappingResult.rows[0].product_id;
          // Unset other primary suppliers for this product
          await db.query(
            `
            UPDATE supplier_products 
            SET is_primary_supplier = false 
            WHERE product_id = $1 AND supplier_product_id != $2
          `,
            [productId, mappingId]
          );
        }
      }

      for (const [key, value] of Object.entries(updateData)) {
        if (allowedFields.includes(key)) {
          updateFields.push(`${key} = $${++paramIndex}`);
          if (key === "bulk_pricing") {
            values.push(JSON.stringify(value));
          } else {
            values.push(value);
          }
        }
      }

      if (updateFields.length === 0) {
        throw new Error("No valid fields to update");
      }

      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

      const query = `
        UPDATE supplier_products 
        SET ${updateFields.join(", ")} 
        WHERE supplier_product_id = $1
        RETURNING *
      `;

      const result = await db.query(query, [mappingId, ...values]);

      if (result.rows.length === 0) {
        throw new Error("Product-supplier mapping not found");
      }

      return result.rows[0];
    } catch (error) {
      throw new Error(
        `Failed to update product-supplier mapping: ${error.message}`
      );
    }
  }

  /**
   * Record supplier performance metric
   * @param {Object} performanceData - Performance metric data
   * @returns {Promise<Object>} Created performance record
   */
  async recordSupplierPerformance(performanceData) {
    try {
      const {
        supplier_id,
        po_id,
        metric_type,
        metric_value,
        metric_unit,
        measurement_date,
        notes,
      } = performanceData;

      const result = await db.query(
        `
        INSERT INTO supplier_performance (
          supplier_id, po_id, metric_type, metric_value,
          metric_unit, measurement_date, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
        [
          supplier_id,
          po_id,
          metric_type,
          metric_value,
          metric_unit,
          measurement_date,
          notes,
        ]
      );

      // Update supplier rating based on performance
      await this.updateSupplierRating(supplier_id);

      return result.rows[0];
    } catch (error) {
      throw new Error(
        `Failed to record supplier performance: ${error.message}`
      );
    }
  }

  /**
   * Update supplier rating based on performance metrics
   * @param {string} supplierId - Supplier ID
   * @returns {Promise<void>}
   */
  async updateSupplierRating(supplierId) {
    try {
      const result = await db.query(
        `
        WITH performance_summary AS (
          SELECT 
            AVG(CASE WHEN metric_type = 'quality' THEN metric_value END) as avg_quality,
            AVG(CASE WHEN metric_type = 'delivery_time' THEN 
              CASE 
                WHEN metric_value <= 0 THEN 5.0  -- On time or early
                WHEN metric_value <= 2 THEN 4.0  -- 1-2 days late
                WHEN metric_value <= 5 THEN 3.0  -- 3-5 days late
                WHEN metric_value <= 10 THEN 2.0 -- 6-10 days late
                ELSE 1.0                         -- More than 10 days late
              END
            END) as delivery_rating,
            COUNT(*) as total_metrics
          FROM supplier_performance 
          WHERE supplier_id = $1 
          AND measurement_date >= CURRENT_DATE - INTERVAL '6 months'
        )
        UPDATE suppliers 
        SET supplier_rating = (
          COALESCE(ps.avg_quality, 0) * 0.6 + 
          COALESCE(ps.delivery_rating, 0) * 0.4
        )
        FROM performance_summary ps
        WHERE supplier_id = $1
      `,
        [supplierId]
      );
    } catch (error) {
      console.error(
        `Failed to update supplier rating for ${supplierId}:`,
        error
      );
    }
  }

  /**
   * Get supplier performance analytics
   * @param {string} supplierId - Supplier ID
   * @param {Object} filters - Date and metric filters
   * @returns {Promise<Object>} Performance analytics
   */
  async getSupplierPerformanceAnalytics(supplierId, filters = {}) {
    try {
      const { startDate, endDate, metricTypes } = filters;

      let query = `
        SELECT 
          metric_type,
          AVG(metric_value) as avg_value,
          MIN(metric_value) as min_value,
          MAX(metric_value) as max_value,
          COUNT(*) as measurement_count,
          STDDEV(metric_value) as std_deviation
        FROM supplier_performance 
        WHERE supplier_id = $1
      `;

      const params = [supplierId];
      let paramIndex = 1;

      if (startDate) {
        query += ` AND measurement_date >= $${++paramIndex}`;
        params.push(startDate);
      }

      if (endDate) {
        query += ` AND measurement_date <= $${++paramIndex}`;
        params.push(endDate);
      }

      if (metricTypes && metricTypes.length > 0) {
        query += ` AND metric_type = ANY($${++paramIndex})`;
        params.push(metricTypes);
      }

      query += ` GROUP BY metric_type ORDER BY metric_type`;

      const result = await db.query(query, params);
      return result.rows;
    } catch (error) {
      throw new Error(
        `Failed to get supplier performance analytics: ${error.message}`
      );
    }
  }

  /**
   * Get preferred suppliers for a product
   * @param {string} productId - Product ID
   * @param {number} limit - Number of suppliers to return
   * @returns {Promise<Array>} Preferred suppliers ranked by score
   */
  async getPreferredSuppliersForProduct(productId, limit = 3) {
    try {
      const result = await db.query(
        `
        SELECT 
          sp.*,
          s.supplier_name,
          s.supplier_rating,
          s.preferred_supplier,
          s.email,
          s.phone,
          s.payment_terms,
          -- Calculate supplier score based on multiple factors
          (
            COALESCE(s.supplier_rating, 0) * 0.4 +
            CASE WHEN s.preferred_supplier THEN 2.0 ELSE 0 END +
            CASE WHEN sp.is_primary_supplier THEN 1.5 ELSE 0 END +
            (5.0 - LEAST(sp.cost_per_unit / NULLIF(avg_cost.avg_cost, 0), 5.0)) * 0.3 +
            (10.0 - LEAST(sp.lead_time_days, 10)) / 10.0 * 0.3
          ) as supplier_score
        FROM supplier_products sp
        JOIN suppliers s ON sp.supplier_id = s.supplier_id
        CROSS JOIN (
          SELECT AVG(cost_per_unit) as avg_cost 
          FROM supplier_products 
          WHERE product_id = $1 AND discontinued = false
        ) avg_cost
        WHERE sp.product_id = $1 
        AND s.is_active = true 
        AND sp.discontinued = false
        ORDER BY supplier_score DESC, sp.cost_per_unit ASC
        LIMIT $2
      `,
        [productId, limit]
      );

      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get preferred suppliers: ${error.message}`);
    }
  }

  /**
   * Calculate bulk pricing for a quantity
   * @param {string} supplierProductId - Supplier product mapping ID
   * @param {number} quantity - Order quantity
   * @returns {Promise<Object>} Pricing information
   */
  async calculateBulkPricing(supplierProductId, quantity) {
    try {
      const result = await db.query(
        `
        SELECT cost_per_unit, bulk_pricing, minimum_order_quantity
        FROM supplier_products 
        WHERE supplier_product_id = $1
      `,
        [supplierProductId]
      );

      if (result.rows.length === 0) {
        throw new Error("Supplier product mapping not found");
      }

      const { cost_per_unit, bulk_pricing, minimum_order_quantity } =
        result.rows[0];

      if (quantity < minimum_order_quantity) {
        return {
          error: `Minimum order quantity is ${minimum_order_quantity}`,
          minimum_order_quantity,
        };
      }

      let unitPrice = cost_per_unit;
      let appliedTier = null;

      // Apply bulk pricing if available
      if (bulk_pricing && bulk_pricing.length > 0) {
        const sortedTiers = bulk_pricing.sort(
          (a, b) => b.min_quantity - a.min_quantity
        );

        for (const tier of sortedTiers) {
          if (quantity >= tier.min_quantity) {
            unitPrice = tier.price;
            appliedTier = tier;
            break;
          }
        }
      }

      return {
        quantity,
        unit_price: unitPrice,
        total_cost: quantity * unitPrice,
        base_unit_price: cost_per_unit,
        savings: quantity * (cost_per_unit - unitPrice),
        applied_tier: appliedTier,
        minimum_order_quantity,
      };
    } catch (error) {
      throw new Error(`Failed to calculate bulk pricing: ${error.message}`);
    }
  }
}

module.exports = SupplierManagementService;
