const db = require("../../config/database");
const { v4: uuidv4 } = require("uuid");

/**
 * Engine for managing inventory allocation across multiple sales channels
 * Prevents overselling and optimizes stock distribution
 */
class InventoryAllocationEngine {
  constructor() {
    this.allocationStrategies = new Map([
      ["equal_distribution", this.equalDistributionStrategy.bind(this)],
      ["priority_based", this.priorityBasedStrategy.bind(this)],
      ["performance_based", this.performanceBasedStrategy.bind(this)],
      ["demand_based", this.demandBasedStrategy.bind(this)],
      ["custom_rules", this.customRulesStrategy.bind(this)],
    ]);
  }

  async initialize() {
    // Any initialization logic
  }

  /**
   * Allocate inventory for a product across all channels
   * @param {string} productId - Product ID
   * @param {Object} options - Allocation options
   * @returns {Object} - Allocation result
   */
  async allocateInventory(productId, options = {}) {
    try {
      // Get current inventory and channel information
      const inventoryData = await this.getInventoryData(productId);
      const channels = await this.getProductChannels(productId);

      if (channels.length === 0) {
        return { success: true, message: "No channels configured for product" };
      }

      // Calculate available stock for allocation
      const availableStock =
        inventoryData.current_stock - inventoryData.reserved_stock;

      if (availableStock <= 0) {
        return await this.handleOutOfStock(productId, channels);
      }

      // Get allocation strategy
      const strategy =
        options.strategy || (await this.getDefaultStrategy(productId));
      const allocator = this.allocationStrategies.get(strategy);

      if (!allocator) {
        throw new Error(`Unknown allocation strategy: ${strategy}`);
      }

      // Perform allocation
      const allocations = await allocator(
        productId,
        availableStock,
        channels,
        options
      );

      // Validate allocations
      this.validateAllocations(allocations, availableStock);

      // Save allocations to database
      await this.saveAllocations(productId, allocations);

      // Log allocation event
      await this.logAllocationEvent(productId, strategy, allocations);

      return {
        success: true,
        strategy,
        totalStock: availableStock,
        allocations,
        summary: this.summarizeAllocations(allocations),
      };
    } catch (error) {
      throw new Error(`Failed to allocate inventory: ${error.message}`);
    }
  }

  /**
   * Reallocate inventory when stock levels change
   * @param {string} productId - Product ID
   * @param {number} newStockLevel - New stock level
   * @param {Object} options - Reallocation options
   * @returns {Object} - Reallocation result
   */
  async reallocateInventory(productId, newStockLevel, options = {}) {
    try {
      // Update inventory level
      await db.query(
        "UPDATE inventory SET current_stock = $1, last_updated = CURRENT_TIMESTAMP WHERE product_id = $2",
        [newStockLevel, productId]
      );

      // Trigger reallocation
      const result = await this.allocateInventory(productId, {
        ...options,
        trigger: "stock_update",
      });

      // Check for overselling situations
      await this.checkOverselling(productId);

      return result;
    } catch (error) {
      throw new Error(`Failed to reallocate inventory: ${error.message}`);
    }
  }

  /**
   * Reserve stock for pending orders
   * @param {string} productId - Product ID
   * @param {string} channelId - Channel ID
   * @param {number} quantity - Quantity to reserve
   * @param {string} orderId - Order ID
   * @returns {Object} - Reservation result
   */
  async reserveStock(productId, channelId, quantity, orderId) {
    try {
      // Check if enough stock is available in allocation
      const allocation = await this.getAllocation(productId, channelId);
      const availableInAllocation =
        allocation.allocated_quantity - allocation.reserved_quantity;

      if (availableInAllocation < quantity) {
        // Try to reallocate to meet demand
        const reallocationResult = await this.reallocateInventory(
          productId,
          null,
          {
            urgentRequest: { channelId, quantity },
          }
        );

        if (!reallocationResult.success) {
          return {
            success: false,
            error: "Insufficient stock available",
            available: availableInAllocation,
            requested: quantity,
          };
        }

        // Recheck allocation after reallocation
        const updatedAllocation = await this.getAllocation(
          productId,
          channelId
        );
        const updatedAvailable =
          updatedAllocation.allocated_quantity -
          updatedAllocation.reserved_quantity;

        if (updatedAvailable < quantity) {
          return {
            success: false,
            error: "Insufficient stock after reallocation",
            available: updatedAvailable,
            requested: quantity,
          };
        }
      }

      // Reserve the stock
      await db.query(
        "UPDATE inventory_allocations SET reserved_quantity = reserved_quantity + $1 WHERE product_id = $2 AND channel_id = $3",
        [quantity, productId, channelId]
      );

      // Log reservation
      await this.logReservationEvent(
        productId,
        channelId,
        quantity,
        orderId,
        "reserved"
      );

      return {
        success: true,
        productId,
        channelId,
        quantity,
        orderId,
      };
    } catch (error) {
      throw new Error(`Failed to reserve stock: ${error.message}`);
    }
  }

  /**
   * Release reserved stock (e.g., when order is cancelled)
   * @param {string} productId - Product ID
   * @param {string} channelId - Channel ID
   * @param {number} quantity - Quantity to release
   * @param {string} orderId - Order ID
   * @returns {Object} - Release result
   */
  async releaseReservedStock(productId, channelId, quantity, orderId) {
    try {
      await db.query(
        "UPDATE inventory_allocations SET reserved_quantity = GREATEST(0, reserved_quantity - $1) WHERE product_id = $2 AND channel_id = $3",
        [quantity, productId, channelId]
      );

      // Log release
      await this.logReservationEvent(
        productId,
        channelId,
        quantity,
        orderId,
        "released"
      );

      return {
        success: true,
        productId,
        channelId,
        quantity,
        orderId,
      };
    } catch (error) {
      throw new Error(`Failed to release reserved stock: ${error.message}`);
    }
  }

  /**
   * Confirm sale and reduce allocated stock
   * @param {string} productId - Product ID
   * @param {string} channelId - Channel ID
   * @param {number} quantity - Quantity sold
   * @param {string} orderId - Order ID
   * @returns {Object} - Confirmation result
   */
  async confirmSale(productId, channelId, quantity, orderId) {
    try {
      // Reduce allocated and reserved quantities
      await db.query(
        `
        UPDATE inventory_allocations 
        SET 
          allocated_quantity = GREATEST(0, allocated_quantity - $1),
          reserved_quantity = GREATEST(0, reserved_quantity - $1)
        WHERE product_id = $2 AND channel_id = $3
      `,
        [quantity, productId, channelId]
      );

      // Reduce actual inventory
      await db.query(
        "UPDATE inventory SET current_stock = GREATEST(0, current_stock - $1) WHERE product_id = $2",
        [quantity, productId]
      );

      // Log sale
      await this.logReservationEvent(
        productId,
        channelId,
        quantity,
        orderId,
        "sold"
      );

      // Trigger reallocation if needed
      const inventoryData = await this.getInventoryData(productId);
      if (inventoryData.current_stock <= inventoryData.reorder_point) {
        await this.allocateInventory(productId, { trigger: "low_stock" });
      }

      return {
        success: true,
        productId,
        channelId,
        quantity,
        orderId,
      };
    } catch (error) {
      throw new Error(`Failed to confirm sale: ${error.message}`);
    }
  }

  /**
   * Get allocation summary for a product
   * @param {string} productId - Product ID
   * @returns {Object} - Allocation summary
   */
  async getAllocationSummary(productId) {
    try {
      const result = await db.query(
        `
        SELECT 
          ia.*,
          c.channel_name,
          c.channel_type
        FROM inventory_allocations ia
        JOIN channels c ON ia.channel_id = c.channel_id
        WHERE ia.product_id = $1
        ORDER BY ia.priority DESC, c.channel_name
      `,
        [productId]
      );

      const inventoryData = await this.getInventoryData(productId);

      const allocations = result.rows;
      const totalAllocated = allocations.reduce(
        (sum, alloc) => sum + alloc.allocated_quantity,
        0
      );
      const totalReserved = allocations.reduce(
        (sum, alloc) => sum + alloc.reserved_quantity,
        0
      );

      return {
        productId,
        currentStock: inventoryData.current_stock,
        totalAllocated,
        totalReserved,
        unallocated: inventoryData.current_stock - totalAllocated,
        allocations: allocations.map((alloc) => ({
          channelId: alloc.channel_id,
          channelName: alloc.channel_name,
          channelType: alloc.channel_type,
          allocated: alloc.allocated_quantity,
          reserved: alloc.reserved_quantity,
          available: alloc.allocated_quantity - alloc.reserved_quantity,
          priority: alloc.priority,
          bufferQuantity: alloc.buffer_quantity,
        })),
      };
    } catch (error) {
      throw new Error(`Failed to get allocation summary: ${error.message}`);
    }
  }

  // Allocation Strategies

  async equalDistributionStrategy(
    productId,
    availableStock,
    channels,
    options
  ) {
    const allocations = [];
    const stockPerChannel = Math.floor(availableStock / channels.length);
    const remainder = availableStock % channels.length;

    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i];
      const allocation = stockPerChannel + (i < remainder ? 1 : 0);

      allocations.push({
        channelId: channel.channel_id,
        allocatedQuantity: allocation,
        bufferQuantity: Math.min(allocation * 0.1, 5), // 10% buffer, max 5 units
      });
    }

    return allocations;
  }

  async priorityBasedStrategy(productId, availableStock, channels, options) {
    const allocations = [];
    const totalPriority = channels.reduce((sum, ch) => sum + ch.priority, 0);

    for (const channel of channels) {
      const priorityRatio = channel.priority / totalPriority;
      const allocation = Math.floor(availableStock * priorityRatio);

      allocations.push({
        channelId: channel.channel_id,
        allocatedQuantity: allocation,
        bufferQuantity: Math.min(allocation * 0.15, 10), // 15% buffer for high priority
      });
    }

    return allocations;
  }

  async performanceBasedStrategy(productId, availableStock, channels, options) {
    // Get sales performance data for each channel
    const performanceData = await this.getChannelPerformance(
      productId,
      channels
    );
    const totalSales = performanceData.reduce(
      (sum, perf) => sum + perf.sales,
      0
    );

    const allocations = [];

    for (const performance of performanceData) {
      const salesRatio =
        totalSales > 0 ? performance.sales / totalSales : 1 / channels.length;
      const allocation = Math.floor(availableStock * salesRatio);

      allocations.push({
        channelId: performance.channelId,
        allocatedQuantity: allocation,
        bufferQuantity: Math.min(allocation * 0.2, 15), // 20% buffer based on performance
      });
    }

    return allocations;
  }

  async demandBasedStrategy(productId, availableStock, channels, options) {
    // Get demand forecasts for each channel
    const demandData = await this.getChannelDemandForecasts(
      productId,
      channels
    );
    const totalDemand = demandData.reduce(
      (sum, demand) => sum + demand.predictedDemand,
      0
    );

    const allocations = [];

    for (const demand of demandData) {
      const demandRatio =
        totalDemand > 0
          ? demand.predictedDemand / totalDemand
          : 1 / channels.length;
      const allocation = Math.floor(availableStock * demandRatio);

      allocations.push({
        channelId: demand.channelId,
        allocatedQuantity: allocation,
        bufferQuantity: Math.min(allocation * 0.25, 20), // 25% buffer for high demand
      });
    }

    return allocations;
  }

  async customRulesStrategy(productId, availableStock, channels, options) {
    // Implement custom business rules
    const rules = options.customRules || (await this.getCustomRules(productId));
    const allocations = [];

    // Apply custom allocation logic based on rules
    // This is a simplified version - real implementation would be more complex
    for (const channel of channels) {
      const rule = rules.find((r) => r.channelId === channel.channel_id) || {};
      const minAllocation = rule.minAllocation || 0;
      const maxAllocation = rule.maxAllocation || availableStock;
      const preferredAllocation =
        rule.preferredAllocation ||
        Math.floor(availableStock / channels.length);

      const allocation = Math.max(
        minAllocation,
        Math.min(maxAllocation, preferredAllocation)
      );

      allocations.push({
        channelId: channel.channel_id,
        allocatedQuantity: allocation,
        bufferQuantity: rule.bufferQuantity || 0,
      });
    }

    return allocations;
  }

  // Helper Methods

  async getInventoryData(productId) {
    const result = await db.query(
      "SELECT * FROM inventory WHERE product_id = $1",
      [productId]
    );

    if (result.rows.length === 0) {
      throw new Error("Product inventory not found");
    }

    return result.rows[0];
  }

  async getProductChannels(productId) {
    const result = await db.query(
      `
      SELECT 
        c.*,
        ia.priority,
        ia.allocation_rules
      FROM channels c
      JOIN channel_products cp ON c.channel_id = cp.channel_id
      LEFT JOIN inventory_allocations ia ON c.channel_id = ia.channel_id AND ia.product_id = $1
      WHERE cp.product_id = $1 AND c.is_active = true AND cp.sync_enabled = true
      ORDER BY ia.priority DESC, c.channel_name
    `,
      [productId]
    );

    return result.rows;
  }

  async getAllocation(productId, channelId) {
    const result = await db.query(
      "SELECT * FROM inventory_allocations WHERE product_id = $1 AND channel_id = $2",
      [productId, channelId]
    );

    if (result.rows.length === 0) {
      throw new Error("Allocation not found");
    }

    return result.rows[0];
  }

  async handleOutOfStock(productId, channels) {
    // Set all allocations to 0
    const allocations = channels.map((channel) => ({
      channelId: channel.channel_id,
      allocatedQuantity: 0,
      bufferQuantity: 0,
    }));

    await this.saveAllocations(productId, allocations);

    return {
      success: true,
      message: "Product out of stock - all allocations set to 0",
      allocations,
    };
  }

  async saveAllocations(productId, allocations) {
    for (const allocation of allocations) {
      await db.query(
        `
        UPDATE inventory_allocations 
        SET 
          allocated_quantity = $1,
          buffer_quantity = $2,
          last_updated = CURRENT_TIMESTAMP
        WHERE product_id = $3 AND channel_id = $4
      `,
        [
          allocation.allocatedQuantity,
          allocation.bufferQuantity || 0,
          productId,
          allocation.channelId,
        ]
      );
    }
  }

  validateAllocations(allocations, availableStock) {
    const totalAllocated = allocations.reduce(
      (sum, alloc) => sum + alloc.allocatedQuantity,
      0
    );

    if (totalAllocated > availableStock) {
      throw new Error(
        `Total allocation (${totalAllocated}) exceeds available stock (${availableStock})`
      );
    }

    for (const allocation of allocations) {
      if (allocation.allocatedQuantity < 0) {
        throw new Error("Allocation quantity cannot be negative");
      }
    }
  }

  summarizeAllocations(allocations) {
    return {
      totalChannels: allocations.length,
      totalAllocated: allocations.reduce(
        (sum, alloc) => sum + alloc.allocatedQuantity,
        0
      ),
      totalBuffer: allocations.reduce(
        (sum, alloc) => sum + (alloc.bufferQuantity || 0),
        0
      ),
      channelsWithStock: allocations.filter(
        (alloc) => alloc.allocatedQuantity > 0
      ).length,
    };
  }

  async getDefaultStrategy(productId) {
    // Could be configurable per product or store
    return "equal_distribution";
  }

  async getChannelPerformance(productId, channels) {
    const result = await db.query(
      `
      SELECT 
        cp.channel_id,
        COALESCE(SUM(s.quantity_sold), 0) as sales
      FROM channel_products cp
      LEFT JOIN sales s ON cp.product_id = s.product_id 
        AND s.sale_date >= NOW() - INTERVAL '30 days'
      WHERE cp.product_id = $1 AND cp.channel_id = ANY($2::uuid[])
      GROUP BY cp.channel_id
    `,
      [productId, channels.map((ch) => ch.channel_id)]
    );

    return result.rows.map((row) => ({
      channelId: row.channel_id,
      sales: parseInt(row.sales) || 0,
    }));
  }

  async getChannelDemandForecasts(productId, channels) {
    // Simplified - would integrate with forecasting service
    const forecasts = [];
    for (const channel of channels) {
      forecasts.push({
        channelId: channel.channel_id,
        predictedDemand: Math.floor(Math.random() * 50) + 10, // Placeholder
      });
    }
    return forecasts;
  }

  async getCustomRules(productId) {
    // Get custom allocation rules from database or configuration
    return [];
  }

  async checkOverselling(productId) {
    const result = await db.query(
      `
      SELECT 
        i.current_stock,
        SUM(ia.allocated_quantity) as total_allocated
      FROM inventory i
      LEFT JOIN inventory_allocations ia ON i.product_id = ia.product_id
      WHERE i.product_id = $1
      GROUP BY i.current_stock
    `,
      [productId]
    );

    if (result.rows.length > 0) {
      const { current_stock, total_allocated } = result.rows[0];
      if (total_allocated > current_stock) {
        await this.handleOverselling(productId, current_stock, total_allocated);
      }
    }
  }

  async handleOverselling(productId, currentStock, totalAllocated) {
    // Reallocate to prevent overselling
    await this.allocateInventory(productId, {
      strategy: "equal_distribution",
      trigger: "overselling_detected",
    });
  }

  async logAllocationEvent(productId, strategy, allocations) {
    // Log allocation events for audit trail
    console.log(
      `Allocation event: ${productId}, strategy: ${strategy}, allocations:`,
      allocations
    );
  }

  async logReservationEvent(
    productId,
    channelId,
    quantity,
    orderId,
    eventType
  ) {
    // Log reservation events for audit trail
    console.log(
      `Reservation event: ${eventType}, product: ${productId}, channel: ${channelId}, quantity: ${quantity}, order: ${orderId}`
    );
  }
}

module.exports = InventoryAllocationEngine;
