const db = require("../../config/database");
const { v4: uuidv4 } = require("uuid");

/**
 * Engine for detecting and resolving inventory conflicts across channels
 * Handles situations where channel inventory doesn't match local inventory
 */
class ConflictResolutionEngine {
  constructor() {
    this.resolutionStrategies = new Map([
      ["last_write_wins", this.lastWriteWinsStrategy.bind(this)],
      ["source_priority", this.sourcePriorityStrategy.bind(this)],
      ["manual_review", this.manualReviewStrategy.bind(this)],
      ["aggregate_approach", this.aggregateApproachStrategy.bind(this)],
      ["conservative_approach", this.conservativeApproachStrategy.bind(this)],
      ["intelligent_merge", this.intelligentMergeStrategy.bind(this)],
    ]);

    this.conflictTypes = {
      STOCK_MISMATCH: "stock_mismatch",
      PRICE_MISMATCH: "price_mismatch",
      PRODUCT_MISMATCH: "product_mismatch",
      OVERSOLD: "oversold",
      DUPLICATE_SALE: "duplicate_sale",
      SYNC_TIMEOUT: "sync_timeout",
    };

    this.conflictPriorities = {
      LOW: "low",
      MEDIUM: "medium",
      HIGH: "high",
      CRITICAL: "critical",
    };
  }

  async initialize() {
    // Initialize conflict detection rules and strategies
    await this.loadConflictRules();
  }

  /**
   * Detect conflicts for a specific product across all channels
   * @param {string} productId - Product ID
   * @returns {Array} - Array of detected conflicts
   */
  async detectProductConflicts(productId) {
    try {
      const conflicts = [];

      // Get product data across all channels
      const channelData = await this.getProductChannelData(productId);

      if (channelData.length < 2) {
        return conflicts; // Need at least 2 channels to have conflicts
      }

      // Detect stock mismatches
      const stockConflicts = await this.detectStockMismatches(
        productId,
        channelData
      );
      conflicts.push(...stockConflicts);

      // Detect price mismatches
      const priceConflicts = await this.detectPriceMismatches(
        productId,
        channelData
      );
      conflicts.push(...priceConflicts);

      // Detect overselling situations
      const oversellConflicts = await this.detectOverselling(
        productId,
        channelData
      );
      conflicts.push(...oversellConflicts);

      // Save detected conflicts to database
      for (const conflict of conflicts) {
        await this.saveConflict(conflict);
      }

      return conflicts;
    } catch (error) {
      throw new Error(`Failed to detect conflicts: ${error.message}`);
    }
  }

  /**
   * Detect conflicts across all products for a store
   * @param {string} storeId - Store ID
   * @returns {Array} - Array of detected conflicts
   */
  async detectStoreConflicts(storeId) {
    try {
      const conflicts = [];

      // Get all products for the store that have multiple channels
      const products = await this.getStoreProductsWithMultipleChannels(storeId);

      for (const product of products) {
        const productConflicts = await this.detectProductConflicts(
          product.product_id
        );
        conflicts.push(...productConflicts);
      }

      return conflicts;
    } catch (error) {
      throw new Error(`Failed to detect store conflicts: ${error.message}`);
    }
  }

  /**
   * Resolve a specific conflict using the specified strategy
   * @param {Object} conflict - Conflict object
   * @param {string} strategy - Resolution strategy
   * @param {Object} options - Resolution options
   * @returns {Object} - Resolution result
   */
  async resolveConflict(conflict, strategy, options = {}) {
    try {
      const resolver = this.resolutionStrategies.get(strategy);

      if (!resolver) {
        throw new Error(`Unknown resolution strategy: ${strategy}`);
      }

      // Execute resolution strategy
      const resolution = await resolver(conflict, options);

      // Update conflict status
      await this.updateConflictStatus(
        conflict.conflict_id,
        "resolved",
        strategy,
        resolution
      );

      // Log resolution
      await this.logResolution(conflict, strategy, resolution);

      return {
        success: true,
        strategy,
        resolution,
        conflictId: conflict.conflict_id,
      };
    } catch (error) {
      await this.updateConflictStatus(
        conflict.conflict_id,
        "failed",
        strategy,
        { error: error.message }
      );
      throw new Error(`Failed to resolve conflict: ${error.message}`);
    }
  }

  /**
   * Automatically resolve conflicts using predefined rules
   * @param {Object} conflict - Conflict object
   * @returns {Object} - Auto-resolution result
   */
  async autoResolve(conflict) {
    try {
      // Determine the best strategy based on conflict type and priority
      const strategy = await this.determineAutoResolutionStrategy(conflict);

      if (strategy === "manual_review") {
        return {
          success: false,
          message: "Conflict requires manual review",
          conflictId: conflict.conflict_id,
        };
      }

      // Attempt auto-resolution
      const result = await this.resolveConflict(conflict, strategy, {
        autoResolved: true,
      });

      // Mark as auto-resolved
      await db.query(
        "UPDATE sync_conflicts SET auto_resolved = true WHERE conflict_id = $1",
        [conflict.conflict_id]
      );

      return result;
    } catch (error) {
      // If auto-resolution fails, flag for manual review
      await this.updateConflictStatus(
        conflict.conflict_id,
        "pending",
        "manual_review",
        {
          autoResolutionFailed: true,
          error: error.message,
        }
      );

      return {
        success: false,
        message: "Auto-resolution failed, flagged for manual review",
        error: error.message,
        conflictId: conflict.conflict_id,
      };
    }
  }

  // Conflict Detection Methods

  async detectStockMismatches(productId, channelData) {
    const conflicts = [];
    const localStock = await this.getLocalStock(productId);

    for (const channel of channelData) {
      const difference = Math.abs(
        channel.channel_stock - localStock.allocated_quantity
      );
      const threshold = localStock.current_stock * 0.1; // 10% threshold

      if (difference > threshold && difference > 5) {
        // Absolute threshold of 5 units
        conflicts.push({
          conflictId: uuidv4(),
          productId,
          conflictType: this.conflictTypes.STOCK_MISMATCH,
          priority: this.calculateStockMismatchPriority(
            difference,
            localStock.current_stock
          ),
          conflictData: {
            localStock: localStock.allocated_quantity,
            channelStock: channel.channel_stock,
            channelId: channel.channel_id,
            channelName: channel.channel_name,
            difference,
            detectedAt: new Date(),
          },
        });
      }
    }

    return conflicts;
  }

  async detectPriceMismatches(productId, channelData) {
    const conflicts = [];
    const localPrice = await this.getLocalPrice(productId);

    for (const channel of channelData) {
      if (channel.channel_price && localPrice.selling_price) {
        const priceDifference = Math.abs(
          channel.channel_price - localPrice.selling_price
        );
        const priceThreshold = localPrice.selling_price * 0.05; // 5% threshold

        if (priceDifference > priceThreshold) {
          conflicts.push({
            conflictId: uuidv4(),
            productId,
            conflictType: this.conflictTypes.PRICE_MISMATCH,
            priority: this.conflictPriorities.MEDIUM,
            conflictData: {
              localPrice: localPrice.selling_price,
              channelPrice: channel.channel_price,
              channelId: channel.channel_id,
              channelName: channel.channel_name,
              difference: priceDifference,
              detectedAt: new Date(),
            },
          });
        }
      }
    }

    return conflicts;
  }

  async detectOverselling(productId, channelData) {
    const conflicts = [];
    const localStock = await this.getLocalStock(productId);
    const totalChannelStock = channelData.reduce(
      (sum, ch) => sum + (ch.channel_stock || 0),
      0
    );

    if (totalChannelStock > localStock.current_stock * 1.1) {
      // 10% tolerance
      conflicts.push({
        conflictId: uuidv4(),
        productId,
        conflictType: this.conflictTypes.OVERSOLD,
        priority: this.conflictPriorities.CRITICAL,
        conflictData: {
          localStock: localStock.current_stock,
          totalChannelStock,
          oversoldBy: totalChannelStock - localStock.current_stock,
          channels: channelData.map((ch) => ({
            channelId: ch.channel_id,
            channelName: ch.channel_name,
            stock: ch.channel_stock,
          })),
          detectedAt: new Date(),
        },
      });
    }

    return conflicts;
  }

  // Resolution Strategies

  async lastWriteWinsStrategy(conflict, options) {
    const conflictData = conflict.conflict_data;

    // Find the most recently updated channel
    const channelUpdates = await this.getChannelUpdateTimestamps(
      conflict.product_id,
      conflictData.channels || [conflictData]
    );

    const latestUpdate = channelUpdates.reduce((latest, current) =>
      current.last_updated > latest.last_updated ? current : latest
    );

    // Apply the latest value as the source of truth
    await this.applyChannelValueAsSourceOfTruth(
      conflict.product_id,
      latestUpdate
    );

    return {
      strategy: "last_write_wins",
      chosenSource: latestUpdate.channel_id,
      chosenValue: latestUpdate.value,
      appliedAt: new Date(),
    };
  }

  async sourcePriorityStrategy(conflict, options) {
    const priorityOrder =
      options.priorityOrder || (await this.getChannelPriorityOrder());
    const conflictData = conflict.conflict_data;

    // Find the highest priority channel involved in the conflict
    let highestPriorityChannel = null;
    let highestPriority = -1;

    const channels = conflictData.channels || [conflictData];
    for (const channel of channels) {
      const priority = priorityOrder[channel.channelId] || 0;
      if (priority > highestPriority) {
        highestPriority = priority;
        highestPriorityChannel = channel;
      }
    }

    if (!highestPriorityChannel) {
      throw new Error("No priority channel found for conflict resolution");
    }

    // Apply the highest priority channel's value
    await this.applyChannelValueAsSourceOfTruth(
      conflict.product_id,
      highestPriorityChannel
    );

    return {
      strategy: "source_priority",
      chosenSource: highestPriorityChannel.channelId,
      chosenValue: highestPriorityChannel.value,
      priority: highestPriority,
      appliedAt: new Date(),
    };
  }

  async manualReviewStrategy(conflict, options) {
    // Flag conflict for manual review
    await this.updateConflictStatus(
      conflict.conflict_id,
      "pending",
      "manual_review",
      {
        flaggedFor: "manual_review",
        reason: "Conflict requires human intervention",
        flaggedAt: new Date(),
      }
    );

    return {
      strategy: "manual_review",
      status: "flagged_for_review",
      message: "Conflict has been flagged for manual review",
    };
  }

  async aggregateApproachStrategy(conflict, options) {
    const conflictData = conflict.conflict_data;

    if (conflict.conflict_type === this.conflictTypes.STOCK_MISMATCH) {
      // Take the average of all channel stocks
      const channels = conflictData.channels || [conflictData];
      const stocks = channels
        .map((ch) => ch.channelStock || ch.channel_stock)
        .filter((stock) => stock !== null);
      const averageStock = Math.floor(
        stocks.reduce((sum, stock) => sum + stock, 0) / stocks.length
      );

      await this.updateLocalStock(conflict.product_id, averageStock);

      return {
        strategy: "aggregate_approach",
        method: "average",
        originalValues: stocks,
        resolvedValue: averageStock,
        appliedAt: new Date(),
      };
    }

    throw new Error("Aggregate approach not applicable for this conflict type");
  }

  async conservativeApproachStrategy(conflict, options) {
    const conflictData = conflict.conflict_data;

    if (conflict.conflict_type === this.conflictTypes.STOCK_MISMATCH) {
      // Take the minimum stock to prevent overselling
      const channels = conflictData.channels || [conflictData];
      const stocks = channels
        .map((ch) => ch.channelStock || ch.channel_stock)
        .filter((stock) => stock !== null);
      const minStock = Math.min(...stocks);

      await this.updateLocalStock(conflict.product_id, minStock);

      return {
        strategy: "conservative_approach",
        method: "minimum",
        originalValues: stocks,
        resolvedValue: minStock,
        appliedAt: new Date(),
      };
    }

    throw new Error(
      "Conservative approach not applicable for this conflict type"
    );
  }

  async intelligentMergeStrategy(conflict, options) {
    const conflictData = conflict.conflict_data;

    // Use historical data and patterns to make intelligent decisions
    const historicalData = await this.getHistoricalConflictData(
      conflict.product_id
    );
    const channelReliability = await this.getChannelReliabilityScores(
      conflict.product_id
    );

    // Weight the values based on channel reliability and historical accuracy
    let weightedSum = 0;
    let totalWeight = 0;

    const channels = conflictData.channels || [conflictData];
    for (const channel of channels) {
      const reliability = channelReliability[channel.channelId] || 0.5;
      const value = channel.channelStock || channel.channel_stock;

      if (value !== null) {
        weightedSum += value * reliability;
        totalWeight += reliability;
      }
    }

    const resolvedValue =
      totalWeight > 0 ? Math.floor(weightedSum / totalWeight) : 0;

    await this.updateLocalStock(conflict.product_id, resolvedValue);

    return {
      strategy: "intelligent_merge",
      method: "weighted_average",
      channelWeights: channelReliability,
      resolvedValue,
      appliedAt: new Date(),
    };
  }

  // Helper Methods

  async getProductChannelData(productId) {
    const result = await db.query(
      `
      SELECT 
        cp.channel_id,
        c.channel_name,
        c.channel_type,
        cp.external_product_id,
        ia.allocated_quantity as local_allocated,
        -- These would be populated by sync processes
        NULL as channel_stock,
        NULL as channel_price,
        cp.last_synced
      FROM channel_products cp
      JOIN channels c ON cp.channel_id = c.channel_id
      LEFT JOIN inventory_allocations ia ON cp.product_id = ia.product_id AND cp.channel_id = ia.channel_id
      WHERE cp.product_id = $1 AND c.is_active = true
    `,
      [productId]
    );

    return result.rows;
  }

  async getLocalStock(productId) {
    const result = await db.query(
      `
      SELECT 
        i.current_stock,
        i.reserved_stock,
        COALESCE(SUM(ia.allocated_quantity), 0) as allocated_quantity
      FROM inventory i
      LEFT JOIN inventory_allocations ia ON i.product_id = ia.product_id
      WHERE i.product_id = $1
      GROUP BY i.current_stock, i.reserved_stock
    `,
      [productId]
    );

    if (result.rows.length === 0) {
      throw new Error("Product inventory not found");
    }

    return result.rows[0];
  }

  async getLocalPrice(productId) {
    const result = await db.query(
      "SELECT selling_price, unit_cost FROM products WHERE product_id = $1",
      [productId]
    );

    if (result.rows.length === 0) {
      throw new Error("Product not found");
    }

    return result.rows[0];
  }

  async getStoreProductsWithMultipleChannels(storeId) {
    const result = await db.query(
      `
      SELECT p.product_id, COUNT(cp.channel_id) as channel_count
      FROM products p
      JOIN channel_products cp ON p.product_id = cp.product_id
      WHERE p.store_id = $1
      GROUP BY p.product_id
      HAVING COUNT(cp.channel_id) > 1
    `,
      [storeId]
    );

    return result.rows;
  }

  calculateStockMismatchPriority(difference, totalStock) {
    const percentageDiff = (difference / totalStock) * 100;

    if (percentageDiff > 50) return this.conflictPriorities.CRITICAL;
    if (percentageDiff > 25) return this.conflictPriorities.HIGH;
    if (percentageDiff > 10) return this.conflictPriorities.MEDIUM;
    return this.conflictPriorities.LOW;
  }

  async determineAutoResolutionStrategy(conflict) {
    const strategies = {
      [this.conflictTypes.STOCK_MISMATCH]: {
        [this.conflictPriorities.LOW]: "last_write_wins",
        [this.conflictPriorities.MEDIUM]: "conservative_approach",
        [this.conflictPriorities.HIGH]: "manual_review",
        [this.conflictPriorities.CRITICAL]: "manual_review",
      },
      [this.conflictTypes.PRICE_MISMATCH]: {
        [this.conflictPriorities.LOW]: "source_priority",
        [this.conflictPriorities.MEDIUM]: "source_priority",
        [this.conflictPriorities.HIGH]: "manual_review",
        [this.conflictPriorities.CRITICAL]: "manual_review",
      },
      [this.conflictTypes.OVERSOLD]: {
        [this.conflictPriorities.LOW]: "conservative_approach",
        [this.conflictPriorities.MEDIUM]: "conservative_approach",
        [this.conflictPriorities.HIGH]: "conservative_approach",
        [this.conflictPriorities.CRITICAL]: "manual_review",
      },
    };

    return (
      strategies[conflict.conflict_type]?.[conflict.priority] || "manual_review"
    );
  }

  async saveConflict(conflict) {
    await db.query(
      `
      INSERT INTO sync_conflicts (
        conflict_id, product_id, conflict_type, priority, status, conflict_data
      ) VALUES ($1, $2, $3, $4, 'pending', $5)
    `,
      [
        conflict.conflictId,
        conflict.productId,
        conflict.conflictType,
        conflict.priority,
        JSON.stringify(conflict.conflictData),
      ]
    );
  }

  async updateConflictStatus(conflictId, status, strategy, resolution) {
    await db.query(
      `
      UPDATE sync_conflicts 
      SET status = $1, resolution_strategy = $2, updated_at = CURRENT_TIMESTAMP
      WHERE conflict_id = $3
    `,
      [status, strategy, conflictId]
    );
  }

  async loadConflictRules() {
    // Load conflict detection and resolution rules from configuration
  }

  async logResolution(conflict, strategy, resolution) {
    console.log(
      `Conflict resolved: ${conflict.conflict_id}, strategy: ${strategy}`,
      resolution
    );
  }

  async applyChannelValueAsSourceOfTruth(productId, channelData) {
    // Apply channel value to local inventory
    if (channelData.value !== undefined) {
      await this.updateLocalStock(productId, channelData.value);
    }
  }

  async updateLocalStock(productId, newStock) {
    await db.query(
      "UPDATE inventory SET current_stock = $1, last_updated = CURRENT_TIMESTAMP WHERE product_id = $2",
      [newStock, productId]
    );
  }

  async getChannelUpdateTimestamps(productId, channels) {
    // Get last update timestamps for channels
    return channels.map((ch) => ({
      channel_id: ch.channelId || ch.channel_id,
      last_updated: new Date(), // Would be actual timestamp
      value: ch.channelStock || ch.channel_stock,
    }));
  }

  async getChannelPriorityOrder() {
    const result = await db.query(`
      SELECT channel_id, channel_type
      FROM channels
      ORDER BY 
        CASE channel_type
          WHEN 'shopify' THEN 1
          WHEN 'amazon' THEN 2
          WHEN 'ebay' THEN 3
          WHEN 'square' THEN 4
          ELSE 5
        END
    `);

    const priorities = {};
    result.rows.forEach((row, index) => {
      priorities[row.channel_id] = result.rows.length - index;
    });

    return priorities;
  }

  async getHistoricalConflictData(productId) {
    // Get historical conflict resolution data for learning
    return {};
  }

  async getChannelReliabilityScores(productId) {
    // Calculate reliability scores based on historical accuracy
    const result = await db.query(`
      SELECT channel_id, channel_type FROM channels WHERE is_active = true
    `);

    const scores = {};
    result.rows.forEach((row) => {
      // Default reliability scores - would be calculated from historical data
      scores[row.channel_id] = 0.8; // 80% default reliability
    });

    return scores;
  }
}

module.exports = ConflictResolutionEngine;
