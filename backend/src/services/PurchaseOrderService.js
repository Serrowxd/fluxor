const db = require("../../config/database");
const SupplierManagementService = require("./SupplierManagementService");

/**
 * PurchaseOrderService
 *
 * Handles all purchase order operations including:
 * - Automated PO generation based on reorder points
 * - Manual PO creation and management
 * - PO templates and customization
 * - Status tracking and workflow management
 */
class PurchaseOrderService {
  constructor() {
    this.supplierService = new SupplierManagementService();
  }

  /**
   * Generate next PO number
   * @param {string} storeId - Store ID
   * @returns {Promise<string>} Generated PO number
   */
  async generatePONumber(storeId) {
    try {
      const result = await db.query(
        `
        SELECT COUNT(*) + 1 as next_number 
        FROM purchase_orders 
        WHERE store_id = $1
      `,
        [storeId]
      );

      const nextNumber = result.rows[0].next_number;
      const date = new Date();
      const year = date.getFullYear().toString().slice(-2);
      const month = (date.getMonth() + 1).toString().padStart(2, "0");

      return `PO${year}${month}${nextNumber.toString().padStart(4, "0")}`;
    } catch (error) {
      throw new Error(`Failed to generate PO number: ${error.message}`);
    }
  }

  /**
   * Create a new purchase order
   * @param {string} storeId - Store ID
   * @param {string} createdBy - User ID who created the PO
   * @param {Object} poData - Purchase order data
   * @returns {Promise<Object>} Created purchase order
   */
  async createPurchaseOrder(storeId, createdBy, poData) {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      const {
        supplier_id,
        items = [],
        expected_delivery_date,
        payment_terms,
        shipping_address,
        billing_address,
        notes,
        po_number,
      } = poData;

      // Generate PO number if not provided
      const finalPONumber = po_number || (await this.generatePONumber(storeId));

      // Calculate total amount from items
      let totalAmount = 0;
      for (const item of items) {
        const pricing = await this.supplierService.calculateBulkPricing(
          item.supplier_product_id,
          item.quantity
        );

        if (pricing.error) {
          throw new Error(`Item error: ${pricing.error}`);
        }

        totalAmount += pricing.total_cost;
      }

      // Create purchase order
      const poResult = await client.query(
        `
        INSERT INTO purchase_orders (
          store_id, supplier_id, po_number, total_amount,
          expected_delivery_date, payment_terms, shipping_address,
          billing_address, notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
        [
          storeId,
          supplier_id,
          finalPONumber,
          totalAmount,
          expected_delivery_date,
          payment_terms,
          JSON.stringify(shipping_address),
          JSON.stringify(billing_address),
          notes,
          createdBy,
        ]
      );

      const purchaseOrder = poResult.rows[0];

      // Add items to purchase order
      const poItems = [];
      for (const item of items) {
        const pricing = await this.supplierService.calculateBulkPricing(
          item.supplier_product_id,
          item.quantity
        );

        const itemResult = await client.query(
          `
          INSERT INTO purchase_order_items (
            po_id, product_id, supplier_product_id, quantity,
            unit_cost, expected_delivery_date, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `,
          [
            purchaseOrder.po_id,
            item.product_id,
            item.supplier_product_id,
            item.quantity,
            pricing.unit_price,
            item.expected_delivery_date || expected_delivery_date,
            item.notes,
          ]
        );

        poItems.push(itemResult.rows[0]);
      }

      await client.query("COMMIT");

      return {
        ...purchaseOrder,
        items: poItems,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Failed to create purchase order: ${error.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Get purchase orders with filtering and pagination
   * @param {string} storeId - Store ID
   * @param {Object} filters - Filtering options
   * @returns {Promise<Array>} List of purchase orders
   */
  async getPurchaseOrders(storeId, filters = {}) {
    try {
      let query = `
        SELECT 
          po.*,
          s.supplier_name,
          s.email as supplier_email,
          u.email as created_by_email,
          COUNT(poi.po_item_id) as item_count,
          SUM(poi.quantity_received) as total_received_items,
          SUM(poi.quantity) as total_ordered_items
        FROM purchase_orders po
        JOIN suppliers s ON po.supplier_id = s.supplier_id
        LEFT JOIN users u ON po.created_by = u.user_id
        LEFT JOIN purchase_order_items poi ON po.po_id = poi.po_id
        WHERE po.store_id = $1
      `;

      const params = [storeId];
      let paramIndex = 1;

      if (filters.status) {
        if (Array.isArray(filters.status)) {
          query += ` AND po.status = ANY($${++paramIndex})`;
          params.push(filters.status);
        } else {
          query += ` AND po.status = $${++paramIndex}`;
          params.push(filters.status);
        }
      }

      if (filters.supplier_id) {
        query += ` AND po.supplier_id = $${++paramIndex}`;
        params.push(filters.supplier_id);
      }

      if (filters.start_date) {
        query += ` AND po.created_at >= $${++paramIndex}`;
        params.push(filters.start_date);
      }

      if (filters.end_date) {
        query += ` AND po.created_at <= $${++paramIndex}`;
        params.push(filters.end_date);
      }

      if (filters.search) {
        query += ` AND (po.po_number ILIKE $${++paramIndex} OR s.supplier_name ILIKE $${++paramIndex})`;
        params.push(`%${filters.search}%`, `%${filters.search}%`);
        paramIndex++;
      }

      query += `
        GROUP BY po.po_id, s.supplier_name, s.email, u.email
        ORDER BY po.created_at DESC
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
      throw new Error(`Failed to get purchase orders: ${error.message}`);
    }
  }

  /**
   * Get purchase order by ID with full details
   * @param {string} poId - Purchase order ID
   * @param {string} storeId - Store ID for authorization
   * @returns {Promise<Object>} Purchase order with items and supplier details
   */
  async getPurchaseOrderById(poId, storeId) {
    try {
      // Get purchase order details
      const poResult = await db.query(
        `
        SELECT 
          po.*,
          s.*,
          u.email as created_by_email,
          approver.email as approved_by_email
        FROM purchase_orders po
        JOIN suppliers s ON po.supplier_id = s.supplier_id
        LEFT JOIN users u ON po.created_by = u.user_id
        LEFT JOIN users approver ON po.approved_by = approver.user_id
        WHERE po.po_id = $1 AND po.store_id = $2
      `,
        [poId, storeId]
      );

      if (poResult.rows.length === 0) {
        throw new Error("Purchase order not found");
      }

      const purchaseOrder = poResult.rows[0];

      // Get purchase order items
      const itemsResult = await db.query(
        `
        SELECT 
          poi.*,
          p.product_name,
          p.sku,
          sp.supplier_sku,
          sp.supplier_product_name
        FROM purchase_order_items poi
        JOIN products p ON poi.product_id = p.product_id
        LEFT JOIN supplier_products sp ON poi.supplier_product_id = sp.supplier_product_id
        WHERE poi.po_id = $1
        ORDER BY poi.created_at ASC
      `,
        [poId]
      );

      // Get approval history
      const approvalsResult = await db.query(
        `
        SELECT 
          poa.*,
          u.email as approver_email,
          aws.step_name,
          aws.step_order
        FROM purchase_order_approvals poa
        LEFT JOIN users u ON poa.approver_user_id = u.user_id
        LEFT JOIN approval_workflow_steps aws ON poa.step_id = aws.step_id
        WHERE poa.po_id = $1
        ORDER BY aws.step_order ASC, poa.created_at ASC
      `,
        [poId]
      );

      return {
        ...purchaseOrder,
        items: itemsResult.rows,
        approvals: approvalsResult.rows,
      };
    } catch (error) {
      throw new Error(`Failed to get purchase order: ${error.message}`);
    }
  }

  /**
   * Update purchase order status
   * @param {string} poId - Purchase order ID
   * @param {string} storeId - Store ID for authorization
   * @param {string} status - New status
   * @param {string} userId - User making the change
   * @param {Object} additionalData - Additional data based on status change
   * @returns {Promise<Object>} Updated purchase order
   */
  async updatePurchaseOrderStatus(
    poId,
    storeId,
    status,
    userId,
    additionalData = {}
  ) {
    try {
      const allowedStatuses = [
        "draft",
        "submitted",
        "approved",
        "rejected",
        "received",
        "cancelled",
      ];

      if (!allowedStatuses.includes(status)) {
        throw new Error(`Invalid status: ${status}`);
      }

      const updateFields = ["status = $3", "updated_at = CURRENT_TIMESTAMP"];
      const params = [poId, storeId, status];
      let paramIndex = 3;

      // Handle status-specific updates
      switch (status) {
        case "submitted":
          updateFields.push(`submitted_at = $${++paramIndex}`);
          params.push(new Date());
          break;
        case "approved":
          updateFields.push(
            `approved_by = $${++paramIndex}`,
            `approved_at = $${++paramIndex}`
          );
          params.push(userId, new Date());
          break;
        case "received":
          updateFields.push(`received_at = $${++paramIndex}`);
          params.push(additionalData.received_at || new Date());
          if (additionalData.actual_delivery_date) {
            updateFields.push(`actual_delivery_date = $${++paramIndex}`);
            params.push(additionalData.actual_delivery_date);
          }
          break;
        case "cancelled":
          updateFields.push(`cancelled_at = $${++paramIndex}`);
          params.push(new Date());
          if (additionalData.cancellation_reason) {
            updateFields.push(`cancellation_reason = $${++paramIndex}`);
            params.push(additionalData.cancellation_reason);
          }
          break;
      }

      const query = `
        UPDATE purchase_orders 
        SET ${updateFields.join(", ")}
        WHERE po_id = $1 AND store_id = $2
        RETURNING *
      `;

      const result = await db.query(query, params);

      if (result.rows.length === 0) {
        throw new Error("Purchase order not found or not authorized");
      }

      return result.rows[0];
    } catch (error) {
      throw new Error(
        `Failed to update purchase order status: ${error.message}`
      );
    }
  }

  /**
   * Receive items for a purchase order
   * @param {string} poId - Purchase order ID
   * @param {string} storeId - Store ID for authorization
   * @param {Array} receivedItems - Items being received with quantities
   * @param {string} userId - User processing the receipt
   * @returns {Promise<Object>} Receipt summary
   */
  async receiveItems(poId, storeId, receivedItems, userId) {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      // Verify PO exists and is in appropriate status
      const poResult = await client.query(
        `
        SELECT * FROM purchase_orders 
        WHERE po_id = $1 AND store_id = $2 AND status IN ('approved', 'partially_received')
      `,
        [poId, storeId]
      );

      if (poResult.rows.length === 0) {
        throw new Error("Purchase order not found or not in receivable status");
      }

      const receiptSummary = {
        po_id: poId,
        received_items: [],
        total_received: 0,
        fully_received: true,
      };

      // Process each received item
      for (const item of receivedItems) {
        const { po_item_id, quantity_received, actual_delivery_date, notes } =
          item;

        // Update the purchase order item
        const updateResult = await client.query(
          `
          UPDATE purchase_order_items 
          SET 
            quantity_received = quantity_received + $1,
            actual_delivery_date = COALESCE($2, actual_delivery_date),
            notes = COALESCE($3, notes),
            updated_at = CURRENT_TIMESTAMP
          WHERE po_item_id = $4 AND po_id = $5
          RETURNING *, (quantity - quantity_received) as remaining_quantity
        `,
          [quantity_received, actual_delivery_date, notes, po_item_id, poId]
        );

        if (updateResult.rows.length === 0) {
          throw new Error(`Purchase order item ${po_item_id} not found`);
        }

        const updatedItem = updateResult.rows[0];

        // Check if over-receiving
        if (updatedItem.quantity_received > updatedItem.quantity) {
          throw new Error(
            `Cannot receive more than ordered quantity for item ${po_item_id}`
          );
        }

        // Update inventory
        await client.query(
          `
          UPDATE inventory 
          SET 
            current_stock = current_stock + $1,
            last_updated = CURRENT_TIMESTAMP
          WHERE product_id = $2
        `,
          [quantity_received, updatedItem.product_id]
        );

        receiptSummary.received_items.push({
          po_item_id,
          product_id: updatedItem.product_id,
          quantity_received,
          remaining_quantity: updatedItem.remaining_quantity,
        });

        receiptSummary.total_received += quantity_received;

        if (updatedItem.remaining_quantity > 0) {
          receiptSummary.fully_received = false;
        }
      }

      // Update PO status if fully received
      if (receiptSummary.fully_received) {
        await client.query(
          `
          UPDATE purchase_orders 
          SET status = 'received', received_at = CURRENT_TIMESTAMP
          WHERE po_id = $1
        `,
          [poId]
        );
      } else {
        await client.query(
          `
          UPDATE purchase_orders 
          SET status = 'partially_received'
          WHERE po_id = $1 AND status != 'partially_received'
        `,
          [poId]
        );
      }

      await client.query("COMMIT");
      return receiptSummary;
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Failed to receive items: ${error.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Generate automated purchase orders based on reorder rules
   * @param {string} storeId - Store ID
   * @param {Object} options - Generation options
   * @returns {Promise<Array>} Generated purchase orders
   */
  async generateAutomaticPurchaseOrders(storeId, options = {}) {
    try {
      const {
        dryRun = false,
        supplierId = null,
        productIds = null,
        maxPOsPerSupplier = 5,
      } = options;

      // Find products that need reordering
      let query = `
        SELECT 
          rr.*,
          i.current_stock,
          i.available_stock,
          p.product_name,
          p.sku,
          s.supplier_name,
          s.supplier_id,
          sp.cost_per_unit,
          sp.minimum_order_quantity,
          sp.lead_time_days,
          -- Calculate recommended order quantity (EOQ-style)
          GREATEST(
            rr.reorder_quantity * rr.seasonal_adjustment_factor,
            sp.minimum_order_quantity,
            (rr.reorder_point + rr.safety_stock - i.available_stock)
          )::INTEGER as recommended_quantity
        FROM reorder_rules rr
        JOIN products p ON rr.product_id = p.product_id
        JOIN inventory i ON p.product_id = i.product_id
        JOIN suppliers s ON rr.supplier_id = s.supplier_id
        JOIN supplier_products sp ON rr.supplier_id = sp.supplier_id AND rr.product_id = sp.product_id
        WHERE p.store_id = $1
        AND rr.auto_reorder_enabled = true
        AND s.is_active = true
        AND sp.discontinued = false
        AND i.available_stock <= rr.reorder_point
        AND (rr.effective_until IS NULL OR rr.effective_until >= CURRENT_DATE)
        AND rr.effective_from <= CURRENT_DATE
      `;

      const params = [storeId];
      let paramIndex = 1;

      if (supplierId) {
        query += ` AND s.supplier_id = $${++paramIndex}`;
        params.push(supplierId);
      }

      if (productIds && productIds.length > 0) {
        query += ` AND p.product_id = ANY($${++paramIndex})`;
        params.push(productIds);
      }

      query += ` ORDER BY rr.rule_priority DESC, i.available_stock ASC`;

      const reorderResult = await db.query(query, params);
      const reorderItems = reorderResult.rows;

      if (reorderItems.length === 0) {
        return {
          message: "No products need reordering at this time",
          generated_pos: [],
        };
      }

      // Group by supplier
      const supplierGroups = reorderItems.reduce((groups, item) => {
        const supplierId = item.supplier_id;
        if (!groups[supplierId]) {
          groups[supplierId] = {
            supplier: {
              supplier_id: supplierId,
              supplier_name: item.supplier_name,
            },
            items: [],
          };
        }
        groups[supplierId].items.push(item);
        return groups;
      }, {});

      const generatedPOs = [];

      // Generate POs for each supplier
      for (const [supplierId, group] of Object.entries(supplierGroups)) {
        if (generatedPOs.length >= maxPOsPerSupplier) break;

        const poItems = group.items.map((item) => ({
          product_id: item.product_id,
          supplier_product_id: item.supplier_product_id,
          quantity: item.recommended_quantity,
          expected_delivery_date: new Date(
            Date.now() + item.lead_time_days * 24 * 60 * 60 * 1000
          ),
          notes: `Auto-generated reorder - Current stock: ${item.available_stock}, Reorder point: ${item.reorder_point}`,
        }));

        if (dryRun) {
          generatedPOs.push({
            supplier: group.supplier,
            items: poItems,
            estimated_total: poItems.reduce((sum, item) => {
              const matchingRule = group.items.find(
                (r) => r.product_id === item.product_id
              );
              return sum + item.quantity * matchingRule.cost_per_unit;
            }, 0),
            would_create: true,
          });
        } else {
          try {
            const po = await this.createPurchaseOrder(storeId, "system", {
              supplier_id: supplierId,
              items: poItems,
              notes: "Auto-generated purchase order based on reorder rules",
              expected_delivery_date: new Date(
                Date.now() + 7 * 24 * 60 * 60 * 1000
              ), // 1 week default
            });

            generatedPOs.push(po);
          } catch (error) {
            console.error(
              `Failed to create auto PO for supplier ${supplierId}:`,
              error
            );
          }
        }
      }

      return {
        message: `${dryRun ? "Would generate" : "Generated"} ${
          generatedPOs.length
        } purchase orders`,
        generated_pos: generatedPOs,
        reorder_items_found: reorderItems.length,
      };
    } catch (error) {
      throw new Error(
        `Failed to generate automatic purchase orders: ${error.message}`
      );
    }
  }

  /**
   * Get purchase order analytics
   * @param {string} storeId - Store ID
   * @param {Object} filters - Date and other filters
   * @returns {Promise<Object>} Analytics data
   */
  async getPurchaseOrderAnalytics(storeId, filters = {}) {
    try {
      const { startDate, endDate } = filters;
      let dateFilter = "";
      const params = [storeId];
      let paramIndex = 1;

      if (startDate || endDate) {
        if (startDate) {
          dateFilter += ` AND po.created_at >= $${++paramIndex}`;
          params.push(startDate);
        }
        if (endDate) {
          dateFilter += ` AND po.created_at <= $${++paramIndex}`;
          params.push(endDate);
        }
      }

      // Overall statistics
      const statsResult = await db.query(
        `
        SELECT 
          COUNT(*) as total_pos,
          COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_count,
          COUNT(CASE WHEN status = 'submitted' THEN 1 END) as submitted_count,
          COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_count,
          COUNT(CASE WHEN status = 'received' THEN 1 END) as received_count,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_count,
          SUM(total_amount) as total_value,
          AVG(total_amount) as avg_po_value,
          AVG(EXTRACT(DAY FROM (received_at - created_at))) as avg_cycle_time_days
        FROM purchase_orders po
        WHERE store_id = $1 ${dateFilter}
      `,
        params
      );

      // Top suppliers by volume
      const topSuppliersResult = await db.query(
        `
        SELECT 
          s.supplier_name,
          s.supplier_id,
          COUNT(po.po_id) as po_count,
          SUM(po.total_amount) as total_value,
          AVG(po.total_amount) as avg_po_value
        FROM purchase_orders po
        JOIN suppliers s ON po.supplier_id = s.supplier_id
        WHERE po.store_id = $1 ${dateFilter}
        GROUP BY s.supplier_id, s.supplier_name
        ORDER BY total_value DESC
        LIMIT 10
      `,
        params
      );

      // Monthly trends
      const trendsResult = await db.query(
        `
        SELECT 
          DATE_TRUNC('month', created_at) as month,
          COUNT(*) as po_count,
          SUM(total_amount) as total_value
        FROM purchase_orders po
        WHERE store_id = $1 ${dateFilter}
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY month ASC
      `,
        params
      );

      return {
        summary: statsResult.rows[0],
        top_suppliers: topSuppliersResult.rows,
        monthly_trends: trendsResult.rows,
      };
    } catch (error) {
      throw new Error(
        `Failed to get purchase order analytics: ${error.message}`
      );
    }
  }

  /**
   * Cancel a purchase order
   * @param {string} poId - Purchase order ID
   * @param {string} storeId - Store ID for authorization
   * @param {string} userId - User cancelling the PO
   * @param {string} reason - Cancellation reason
   * @returns {Promise<Object>} Cancelled purchase order
   */
  async cancelPurchaseOrder(poId, storeId, userId, reason) {
    try {
      const result = await db.query(
        `
        UPDATE purchase_orders 
        SET 
          status = 'cancelled',
          cancelled_at = CURRENT_TIMESTAMP,
          cancellation_reason = $3,
          updated_at = CURRENT_TIMESTAMP
        WHERE po_id = $1 AND store_id = $2 AND status IN ('draft', 'submitted', 'approved')
        RETURNING *
      `,
        [poId, storeId, reason]
      );

      if (result.rows.length === 0) {
        throw new Error("Purchase order not found or cannot be cancelled");
      }

      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to cancel purchase order: ${error.message}`);
    }
  }
}

module.exports = PurchaseOrderService;
