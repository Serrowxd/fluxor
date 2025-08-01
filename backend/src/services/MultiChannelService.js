const db = require("../../config/database");
const ChannelFactory = require("./channels/ChannelFactory");
const InventoryAllocationEngine = require("./InventoryAllocationEngine");
const ConflictResolutionEngine = require("./ConflictResolutionEngine");
const SyncMonitoringService = require("./SyncMonitoringService");
const { redisClient } = require("../../config/redis");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

/**
 * Main service for coordinating multi-channel inventory synchronization
 * Manages all channels, handles sync operations, and resolves conflicts
 */
class MultiChannelService {
  constructor() {
    this.channelFactory = new ChannelFactory();
    this.allocationEngine = new InventoryAllocationEngine();
    this.conflictResolver = new ConflictResolutionEngine();
    this.syncMonitor = new SyncMonitoringService();
    if (!process.env.ENCRYPTION_KEY) {
      throw new Error('ENCRYPTION_KEY environment variable is required');
    }
    this.encryptionKey = process.env.ENCRYPTION_KEY;
  }

  /**
   * Initialize multi-channel service
   */
  async initialize() {
    await this.allocationEngine.initialize();
    await this.conflictResolver.initialize();
    await this.syncMonitor.initialize();
  }

  /**
   * Get all active channels for a store
   * @param {string} storeId - Store ID
   * @returns {Array} - Array of active channels
   */
  async getActiveChannels(storeId) {
    try {
      const result = await db.query(
        `
        SELECT 
          c.*,
          cc.credential_id,
          cc.is_valid as credentials_valid,
          cc.last_refreshed,
          COUNT(cp.channel_product_id) as product_count
        FROM channels c
        LEFT JOIN channel_credentials cc ON c.channel_id = cc.channel_id AND cc.store_id = $1
        LEFT JOIN channel_products cp ON c.channel_id = cp.channel_id
        WHERE c.is_active = true AND c.sync_enabled = true
        GROUP BY c.channel_id, cc.credential_id, cc.is_valid, cc.last_refreshed
        ORDER BY c.channel_name
      `,
        [storeId]
      );

      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get active channels: ${error.message}`);
    }
  }

  /**
   * Connect a new channel for a store
   * @param {string} storeId - Store ID
   * @param {string} channelType - Type of channel to connect
   * @param {Object} credentials - Channel credentials
   * @returns {Object} - Connection result
   */
  async connectChannel(storeId, channelType, credentials) {
    try {
      // Get channel configuration
      const channelResult = await db.query(
        "SELECT * FROM channels WHERE channel_type = $1",
        [channelType]
      );

      if (channelResult.rows.length === 0) {
        throw new Error(`Unsupported channel type: ${channelType}`);
      }

      const channelConfig = channelResult.rows[0];

      // Test connection with credentials
      const connector = await this.channelFactory.createConnector(
        channelConfig,
        credentials
      );

      // Perform health check
      const healthCheck = await connector.healthCheck();
      if (healthCheck.status !== "healthy") {
        throw new Error(`Channel health check failed: ${healthCheck.error}`);
      }

      // Encrypt and store credentials
      const encryptedCredentials = this.encryptCredentials(credentials);

      await db.query(
        `
        INSERT INTO channel_credentials (store_id, channel_id, credentials_encrypted, is_valid)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (store_id, channel_id) 
        DO UPDATE SET 
          credentials_encrypted = $3,
          is_valid = true,
          last_refreshed = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `,
        [storeId, channelConfig.channel_id, encryptedCredentials]
      );

      // Initialize sync for this channel
      await this.initializeChannelSync(storeId, channelConfig.channel_id);

      return {
        success: true,
        channelId: channelConfig.channel_id,
        channelType,
        healthCheck,
      };
    } catch (error) {
      throw new Error(`Failed to connect channel: ${error.message}`);
    }
  }

  /**
   * Disconnect a channel for a store
   * @param {string} storeId - Store ID
   * @param {string} channelId - Channel ID
   * @returns {Object} - Disconnection result
   */
  async disconnectChannel(storeId, channelId) {
    try {
      // Remove credentials
      await db.query(
        "DELETE FROM channel_credentials WHERE store_id = $1 AND channel_id = $2",
        [storeId, channelId]
      );

      // Remove channel products mapping
      await db.query(
        "DELETE FROM channel_products WHERE channel_id = $1 AND product_id IN (SELECT product_id FROM products WHERE store_id = $2)",
        [channelId, storeId]
      );

      // Remove inventory allocations
      await db.query(
        "DELETE FROM inventory_allocations WHERE channel_id = $1 AND product_id IN (SELECT product_id FROM products WHERE store_id = $2)",
        [channelId, storeId]
      );

      // Remove from connector cache
      this.channelFactory.removeConnector(storeId, channelId);

      return {
        success: true,
        channelId,
      };
    } catch (error) {
      throw new Error(`Failed to disconnect channel: ${error.message}`);
    }
  }

  /**
   * Perform full inventory sync across all channels for a store
   * @param {string} storeId - Store ID
   * @param {Object} options - Sync options
   * @returns {Object} - Sync results
   */
  async syncInventoryAllChannels(storeId, options = {}) {
    try {
      const activeChannels = await this.getActiveChannels(storeId);
      const syncResults = [];

      // Start sync monitoring
      const syncId = uuidv4();
      await this.syncMonitor.startSync(
        syncId,
        storeId,
        "inventory",
        activeChannels.length
      );

      for (const channel of activeChannels) {
        try {
          if (!channel.credentials_valid) {
            syncResults.push({
              channelId: channel.channel_id,
              channelType: channel.channel_type,
              success: false,
              error: "Invalid credentials",
            });
            continue;
          }

          const result = await this.syncChannelInventory(
            storeId,
            channel.channel_id,
            options
          );
          syncResults.push({
            channelId: channel.channel_id,
            channelType: channel.channel_type,
            ...result,
          });
        } catch (error) {
          syncResults.push({
            channelId: channel.channel_id,
            channelType: channel.channel_type,
            success: false,
            error: error.message,
          });
        }
      }

      // Complete sync monitoring
      await this.syncMonitor.completeSync(syncId, syncResults);

      // Check for conflicts
      const conflicts = await this.detectInventoryConflicts(storeId);
      if (conflicts.length > 0) {
        await this.handleSyncConflicts(storeId, conflicts);
      }

      return {
        syncId,
        totalChannels: activeChannels.length,
        successfulChannels: syncResults.filter((r) => r.success).length,
        failedChannels: syncResults.filter((r) => !r.success).length,
        results: syncResults,
        conflicts: conflicts.length,
      };
    } catch (error) {
      throw new Error(
        `Failed to sync inventory across channels: ${error.message}`
      );
    }
  }

  /**
   * Sync inventory for a specific channel
   * @param {string} storeId - Store ID
   * @param {string} channelId - Channel ID
   * @param {Object} options - Sync options
   * @returns {Object} - Sync result
   */
  async syncChannelInventory(storeId, channelId, options = {}) {
    try {
      // Get channel configuration and credentials
      const { channelConfig, credentials } = await this.getChannelConfig(
        storeId,
        channelId
      );

      // Create connector
      const connector = await this.channelFactory.getConnector(
        storeId,
        channelId,
        channelConfig,
        credentials
      );

      // Get products to sync
      const products = await this.getProductsForSync(
        storeId,
        channelId,
        options
      );

      // Prepare sync request
      const syncRequest = {
        storeId,
        channelId,
        updates: products.map((product) => ({
          productId: product.product_id,
          externalProductId: product.external_product_id,
          quantity: product.allocated_quantity,
          price: product.selling_price,
          sku: product.sku,
        })),
      };

      // Perform sync
      const syncResult = await connector.syncInventory(syncRequest);

      // Update sync status
      await this.updateSyncStatus(storeId, channelId, "inventory", syncResult);

      // Update last sync timestamps
      await this.updateLastSyncTimestamps(products, syncResult);

      return {
        success: true,
        ...syncResult,
      };
    } catch (error) {
      await this.updateSyncStatus(storeId, channelId, "inventory", {
        success: false,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Handle webhook from a channel
   * @param {string} channelType - Channel type
   * @param {Object} payload - Webhook payload
   * @param {Object} headers - Request headers
   * @returns {Object} - Processing result
   */
  async handleWebhook(channelType, payload, headers) {
    try {
      // Log webhook
      const logId = await this.logWebhook(channelType, payload, headers);

      // Get channel configuration
      const channelResult = await db.query(
        "SELECT * FROM channels WHERE channel_type = $1",
        [channelType]
      );

      if (channelResult.rows.length === 0) {
        throw new Error(`Unknown channel type: ${channelType}`);
      }

      const channelConfig = channelResult.rows[0];

      // Create temporary connector for webhook validation
      const connector = await this.channelFactory.createConnector(
        channelConfig,
        {}
      );

      // Validate webhook signature
      const signature = headers["x-signature"] || headers["signature"];
      const isValid = connector.validateWebhookSignature(
        payload,
        signature,
        channelConfig.webhook_secret
      );

      if (!isValid) {
        await this.updateWebhookLog(logId, "failed", "Invalid signature");
        throw new Error("Invalid webhook signature");
      }

      // Process webhook
      const result = await connector.processWebhook(payload);

      // Update webhook log
      await this.updateWebhookLog(logId, "processed", null, result);

      // Handle inventory updates from webhook
      if (result.type === "inventory_update") {
        await this.handleWebhookInventoryUpdate(result);
      }

      return {
        success: true,
        result,
      };
    } catch (error) {
      throw new Error(`Failed to handle webhook: ${error.message}`);
    }
  }

  /**
   * Get sync status for all channels
   * @param {string} storeId - Store ID
   * @returns {Array} - Array of sync statuses
   */
  async getSyncStatus(storeId) {
    try {
      const result = await db.query(
        `
        SELECT 
          c.channel_id,
          c.channel_type,
          c.channel_name,
          ss.sync_id,
          ss.sync_type,
          ss.status,
          ss.started_at,
          ss.completed_at,
          ss.total_records,
          ss.processed_records,
          ss.successful_records,
          ss.failed_records,
          ss.error_message,
          ss.sync_details
        FROM channels c
        LEFT JOIN sync_status ss ON c.channel_id = ss.channel_id AND ss.store_id = $1
        WHERE c.is_active = true
        ORDER BY c.channel_name, ss.started_at DESC
      `,
        [storeId]
      );

      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get sync status: ${error.message}`);
    }
  }

  /**
   * Get pending conflicts for a store
   * @param {string} storeId - Store ID
   * @returns {Array} - Array of pending conflicts
   */
  async getPendingConflicts(storeId) {
    try {
      const result = await db.query(
        `
        SELECT 
          sc.*,
          p.product_name,
          p.sku
        FROM sync_conflicts sc
        JOIN products p ON sc.product_id = p.product_id
        WHERE p.store_id = $1 AND sc.status = 'pending'
        ORDER BY sc.priority DESC, sc.created_at ASC
      `,
        [storeId]
      );

      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get pending conflicts: ${error.message}`);
    }
  }

  /**
   * Resolve a specific conflict
   * @param {string} conflictId - Conflict ID
   * @param {string} strategy - Resolution strategy
   * @param {string} userId - User ID who is resolving
   * @returns {Object} - Resolution result
   */
  async resolveConflict(conflictId, strategy, userId) {
    try {
      // Get conflict details
      const conflictResult = await db.query(
        "SELECT * FROM sync_conflicts WHERE conflict_id = $1",
        [conflictId]
      );

      if (conflictResult.rows.length === 0) {
        throw new Error("Conflict not found");
      }

      const conflict = conflictResult.rows[0];

      // Resolve using conflict resolution engine
      const resolution = await this.conflictResolver.resolveConflict(
        conflict,
        strategy
      );

      // Update conflict status
      await db.query(
        `
        UPDATE sync_conflicts 
        SET status = 'resolved', 
            resolution_strategy = $1,
            resolved_by = $2,
            resolved_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE conflict_id = $3
      `,
        [strategy, userId, conflictId]
      );

      return {
        success: true,
        conflictId,
        strategy,
        resolution,
      };
    } catch (error) {
      throw new Error(`Failed to resolve conflict: ${error.message}`);
    }
  }

  // Private helper methods

  async getChannelConfig(storeId, channelId) {
    const result = await db.query(
      `
      SELECT 
        c.*,
        cc.credentials_encrypted
      FROM channels c
      JOIN channel_credentials cc ON c.channel_id = cc.channel_id
      WHERE c.channel_id = $1 AND cc.store_id = $2
    `,
      [channelId, storeId]
    );

    if (result.rows.length === 0) {
      throw new Error("Channel configuration not found");
    }

    const row = result.rows[0];
    const credentials = this.decryptCredentials(row.credentials_encrypted);

    return {
      channelConfig: row,
      credentials,
    };
  }

  async getProductsForSync(storeId, channelId, options) {
    const result = await db.query(
      `
      SELECT 
        p.product_id,
        p.product_name,
        p.sku,
        p.selling_price,
        cp.external_product_id,
        ia.allocated_quantity
      FROM products p
      JOIN channel_products cp ON p.product_id = cp.product_id
      JOIN inventory_allocations ia ON p.product_id = ia.product_id
      WHERE p.store_id = $1 
        AND cp.channel_id = $2 
        AND ia.channel_id = $2
        AND cp.sync_enabled = true
    `,
      [storeId, channelId]
    );

    return result.rows;
  }

  async initializeChannelSync(storeId, channelId) {
    // Initialize inventory allocations for all products
    await db.query(
      `
      INSERT INTO inventory_allocations (product_id, channel_id, allocated_quantity, priority)
      SELECT p.product_id, $2, 0, 1
      FROM products p
      WHERE p.store_id = $1
      ON CONFLICT (product_id, channel_id) DO NOTHING
    `,
      [storeId, channelId]
    );
  }

  async detectInventoryConflicts(storeId) {
    // This would implement conflict detection logic
    // For now, return empty array
    return [];
  }

  async handleSyncConflicts(storeId, conflicts) {
    // This would implement conflict handling logic
    for (const conflict of conflicts) {
      await this.conflictResolver.autoResolve(conflict);
    }
  }

  async updateSyncStatus(storeId, channelId, syncType, result) {
    await db.query(
      `
      INSERT INTO sync_status (
        store_id, channel_id, sync_type, status, 
        total_records, processed_records, successful_records, failed_records,
        error_message, sync_details, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
    `,
      [
        storeId,
        channelId,
        syncType,
        result.success ? "completed" : "failed",
        result.totalProcessed || 0,
        result.totalProcessed || 0,
        result.successful || 0,
        result.failed || 0,
        result.error || null,
        JSON.stringify(result),
      ]
    );
  }

  async updateLastSyncTimestamps(products, syncResult) {
    const productIds = products.map((p) => p.product_id);
    await db.query(
      `
      UPDATE channel_products 
      SET last_synced = CURRENT_TIMESTAMP
      WHERE product_id = ANY($1::uuid[])
    `,
      [productIds]
    );
  }

  async logWebhook(channelType, payload, headers) {
    const channelResult = await db.query(
      "SELECT channel_id FROM channels WHERE channel_type = $1",
      [channelType]
    );

    const channelId = channelResult.rows[0]?.channel_id;

    const result = await db.query(
      `
      INSERT INTO webhook_logs (
        channel_id, webhook_type, http_method, payload, headers
      ) VALUES ($1, $2, $3, $4, $5) RETURNING log_id
    `,
      [
        channelId,
        payload.type || "unknown",
        "POST",
        JSON.stringify(payload),
        JSON.stringify(headers),
      ]
    );

    return result.rows[0].log_id;
  }

  async updateWebhookLog(logId, status, error, responseData) {
    await db.query(
      `
      UPDATE webhook_logs 
      SET processing_status = $1, error_message = $2, response_data = $3, processed_at = CURRENT_TIMESTAMP
      WHERE log_id = $4
    `,
      [status, error, JSON.stringify(responseData), logId]
    );
  }

  async handleWebhookInventoryUpdate(result) {
    // Handle inventory updates from webhooks
    // This would update local inventory and trigger re-allocation
  }

  encryptCredentials(credentials) {
    const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(JSON.stringify(credentials), "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString('hex') + ':' + encrypted;
  }

  decryptCredentials(encryptedCredentials) {
    const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
    const parts = encryptedCredentials.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted);
  }
}

module.exports = MultiChannelService;
