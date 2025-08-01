const db = require("../../config/database");
const { redisClient } = require("../../config/redis");
const { v4: uuidv4 } = require("uuid");

/**
 * Service for monitoring and tracking multi-channel synchronization operations
 * Provides real-time status updates, performance metrics, and error handling
 */
class SyncMonitoringService {
  constructor() {
    this.activeSyncs = new Map();
    this.syncMetrics = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      averageSyncTime: 0,
      channelPerformance: new Map(),
    };
  }

  async initialize() {
    // Initialize monitoring service
    await this.loadActiveSyncs();
    await this.initializeMetrics();
  }

  /**
   * Start tracking a new sync operation
   * @param {string} syncId - Unique sync ID
   * @param {string} storeId - Store ID
   * @param {string} syncType - Type of sync (inventory, orders, products)
   * @param {number} totalChannels - Total number of channels to sync
   * @param {Object} options - Sync options
   * @returns {Object} - Sync tracking result
   */
  async startSync(syncId, storeId, syncType, totalChannels, options = {}) {
    try {
      const syncData = {
        syncId,
        storeId,
        syncType,
        status: "running",
        startedAt: new Date(),
        totalChannels,
        completedChannels: 0,
        successfulChannels: 0,
        failedChannels: 0,
        progress: 0,
        channels: [],
        options,
      };

      // Store in memory for real-time tracking
      this.activeSyncs.set(syncId, syncData);

      // Store in Redis for persistence and sharing across instances
      await redisClient.setEx(`sync:${syncId}`, 3600, JSON.stringify(syncData));

      // Create database record
      await db.query(
        `
        INSERT INTO sync_status (
          sync_id, store_id, sync_type, status, total_records, sync_details
        ) VALUES ($1, $2, $3, 'running', $4, $5)
      `,
        [syncId, storeId, syncType, totalChannels, JSON.stringify(syncData)]
      );

      return {
        success: true,
        syncId,
        status: "started",
        tracking: syncData,
      };
    } catch (error) {
      throw new Error(`Failed to start sync tracking: ${error.message}`);
    }
  }

  /**
   * Update progress for a specific channel in a sync operation
   * @param {string} syncId - Sync ID
   * @param {string} channelId - Channel ID
   * @param {Object} channelResult - Channel sync result
   * @returns {Object} - Update result
   */
  async updateChannelProgress(syncId, channelId, channelResult) {
    try {
      const syncData = this.activeSyncs.get(syncId);

      if (!syncData) {
        throw new Error(`Sync ${syncId} not found`);
      }

      // Update channel data
      const channelUpdate = {
        channelId,
        result: channelResult,
        completedAt: new Date(),
      };

      syncData.channels.push(channelUpdate);
      syncData.completedChannels++;

      if (channelResult.success) {
        syncData.successfulChannels++;
      } else {
        syncData.failedChannels++;
      }

      // Calculate progress percentage
      syncData.progress = Math.round(
        (syncData.completedChannels / syncData.totalChannels) * 100
      );

      // Update status if all channels completed
      if (syncData.completedChannels >= syncData.totalChannels) {
        syncData.status =
          syncData.failedChannels > 0 ? "completed_with_errors" : "completed";
        syncData.completedAt = new Date();
      }

      // Update in memory and Redis
      this.activeSyncs.set(syncId, syncData);
      await redisClient.setEx(`sync:${syncId}`, 3600, JSON.stringify(syncData));

      // Update database
      await this.updateDatabaseSyncStatus(syncId, syncData);

      return {
        success: true,
        syncId,
        progress: syncData.progress,
        status: syncData.status,
      };
    } catch (error) {
      throw new Error(`Failed to update channel progress: ${error.message}`);
    }
  }

  /**
   * Complete a sync operation
   * @param {string} syncId - Sync ID
   * @param {Array} results - Array of channel results
   * @returns {Object} - Completion result
   */
  async completeSync(syncId, results) {
    try {
      const syncData = this.activeSyncs.get(syncId);

      if (!syncData) {
        throw new Error(`Sync ${syncId} not found`);
      }

      // Calculate final metrics
      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;
      const totalDuration = Date.now() - syncData.startedAt.getTime();

      syncData.status = failed > 0 ? "completed_with_errors" : "completed";
      syncData.completedAt = new Date();
      syncData.duration = totalDuration;
      syncData.successfulChannels = successful;
      syncData.failedChannels = failed;
      syncData.progress = 100;
      syncData.results = results;

      // Update tracking data
      this.activeSyncs.set(syncId, syncData);
      await redisClient.setEx(`sync:${syncId}`, 3600, JSON.stringify(syncData));

      // Update database
      await this.updateDatabaseSyncStatus(syncId, syncData);

      // Update metrics
      await this.updateSyncMetrics(syncData);

      // Remove from active syncs after a delay
      setTimeout(() => {
        this.activeSyncs.delete(syncId);
      }, 300000); // Keep for 5 minutes

      return {
        success: true,
        syncId,
        status: syncData.status,
        duration: totalDuration,
        successful,
        failed,
        results,
      };
    } catch (error) {
      throw new Error(`Failed to complete sync: ${error.message}`);
    }
  }

  /**
   * Get current status of a sync operation
   * @param {string} syncId - Sync ID
   * @returns {Object} - Sync status
   */
  async getSyncStatus(syncId) {
    try {
      // Check memory first
      let syncData = this.activeSyncs.get(syncId);

      if (!syncData) {
        // Check Redis
        const redisData = await redisClient.get(`sync:${syncId}`);
        if (redisData) {
          syncData = JSON.parse(redisData);
        }
      }

      if (!syncData) {
        // Check database for historical data
        const result = await db.query(
          "SELECT * FROM sync_status WHERE sync_id = $1",
          [syncId]
        );

        if (result.rows.length === 0) {
          throw new Error(`Sync ${syncId} not found`);
        }

        const row = result.rows[0];
        syncData = {
          syncId: row.sync_id,
          storeId: row.store_id,
          syncType: row.sync_type,
          status: row.status,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          totalChannels: row.total_records,
          successfulChannels: row.successful_records,
          failedChannels: row.failed_records,
          errorMessage: row.error_message,
          details: row.sync_details ? JSON.parse(row.sync_details) : {},
        };
      }

      return {
        success: true,
        sync: syncData,
      };
    } catch (error) {
      throw new Error(`Failed to get sync status: ${error.message}`);
    }
  }

  /**
   * Get all active syncs for a store
   * @param {string} storeId - Store ID
   * @returns {Array} - Array of active syncs
   */
  async getActiveSyncs(storeId) {
    try {
      const activeSyncs = [];

      // Get from memory
      for (const [syncId, syncData] of this.activeSyncs) {
        if (syncData.storeId === storeId && syncData.status === "running") {
          activeSyncs.push(syncData);
        }
      }

      // Get from Redis if not in memory
      if (activeSyncs.length === 0) {
        const keys = await redisClient.keys("sync:*");
        for (const key of keys) {
          const data = await redisClient.get(key);
          if (data) {
            const syncData = JSON.parse(data);
            if (syncData.storeId === storeId && syncData.status === "running") {
              activeSyncs.push(syncData);
            }
          }
        }
      }

      return activeSyncs;
    } catch (error) {
      throw new Error(`Failed to get active syncs: ${error.message}`);
    }
  }

  /**
   * Get sync history for a store
   * @param {string} storeId - Store ID
   * @param {Object} options - Query options
   * @returns {Array} - Array of sync history
   */
  async getSyncHistory(storeId, options = {}) {
    try {
      const limit = options.limit || 50;
      const offset = options.offset || 0;
      const syncType = options.syncType || null;

      let query = `
        SELECT * FROM sync_status 
        WHERE store_id = $1
      `;
      const params = [storeId];

      if (syncType) {
        query += " AND sync_type = $2";
        params.push(syncType);
      }

      query +=
        " ORDER BY started_at DESC LIMIT $" +
        (params.length + 1) +
        " OFFSET $" +
        (params.length + 2);
      params.push(limit, offset);

      const result = await db.query(query, params);

      return result.rows.map((row) => ({
        syncId: row.sync_id,
        syncType: row.sync_type,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        duration: row.completed_at
          ? new Date(row.completed_at).getTime() -
            new Date(row.started_at).getTime()
          : null,
        totalChannels: row.total_records,
        successfulChannels: row.successful_records,
        failedChannels: row.failed_records,
        errorMessage: row.error_message,
      }));
    } catch (error) {
      throw new Error(`Failed to get sync history: ${error.message}`);
    }
  }

  /**
   * Get sync performance metrics
   * @param {string} storeId - Store ID
   * @param {Object} options - Query options
   * @returns {Object} - Performance metrics
   */
  async getSyncMetrics(storeId, options = {}) {
    try {
      const timeframe = options.timeframe || "7 days";

      const result = await db.query(
        `
        SELECT 
          sync_type,
          COUNT(*) as total_syncs,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_syncs,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_syncs,
          COUNT(CASE WHEN status = 'completed_with_errors' THEN 1 END) as partial_syncs,
          AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds,
          MAX(EXTRACT(EPOCH FROM (completed_at - started_at))) as max_duration_seconds,
          MIN(EXTRACT(EPOCH FROM (completed_at - started_at))) as min_duration_seconds
        FROM sync_status 
        WHERE store_id = $1 
          AND started_at >= NOW() - INTERVAL '1 ' || $2
          AND completed_at IS NOT NULL
        GROUP BY sync_type
      `,
        [storeId, timeframe]
      );

      const metrics = {
        timeframe,
        overall: {
          totalSyncs: 0,
          successfulSyncs: 0,
          failedSyncs: 0,
          partialSyncs: 0,
          successRate: 0,
          avgDuration: 0,
        },
        byType: {},
      };

      for (const row of result.rows) {
        const typeMetrics = {
          totalSyncs: parseInt(row.total_syncs),
          successfulSyncs: parseInt(row.successful_syncs),
          failedSyncs: parseInt(row.failed_syncs),
          partialSyncs: parseInt(row.partial_syncs),
          successRate:
            (parseInt(row.successful_syncs) / parseInt(row.total_syncs)) * 100,
          avgDuration: parseFloat(row.avg_duration_seconds),
          maxDuration: parseFloat(row.max_duration_seconds),
          minDuration: parseFloat(row.min_duration_seconds),
        };

        metrics.byType[row.sync_type] = typeMetrics;

        // Update overall metrics
        metrics.overall.totalSyncs += typeMetrics.totalSyncs;
        metrics.overall.successfulSyncs += typeMetrics.successfulSyncs;
        metrics.overall.failedSyncs += typeMetrics.failedSyncs;
        metrics.overall.partialSyncs += typeMetrics.partialSyncs;
      }

      if (metrics.overall.totalSyncs > 0) {
        metrics.overall.successRate =
          (metrics.overall.successfulSyncs / metrics.overall.totalSyncs) * 100;
        metrics.overall.avgDuration =
          Object.values(metrics.byType).reduce(
            (sum, type) => sum + type.avgDuration,
            0
          ) / Object.keys(metrics.byType).length;
      }

      return metrics;
    } catch (error) {
      throw new Error(`Failed to get sync metrics: ${error.message}`);
    }
  }

  /**
   * Cancel an active sync operation
   * @param {string} syncId - Sync ID
   * @param {string} reason - Cancellation reason
   * @returns {Object} - Cancellation result
   */
  async cancelSync(syncId, reason = "User cancelled") {
    try {
      const syncData = this.activeSyncs.get(syncId);

      if (!syncData) {
        throw new Error(`Sync ${syncId} not found or already completed`);
      }

      if (syncData.status !== "running") {
        throw new Error(`Cannot cancel sync with status: ${syncData.status}`);
      }

      // Update status
      syncData.status = "cancelled";
      syncData.completedAt = new Date();
      syncData.cancellationReason = reason;

      // Update tracking data
      this.activeSyncs.set(syncId, syncData);
      await redisClient.setEx(`sync:${syncId}`, 3600, JSON.stringify(syncData));

      // Update database
      await db.query(
        `
        UPDATE sync_status 
        SET status = 'cancelled', 
            completed_at = CURRENT_TIMESTAMP,
            error_message = $1
        WHERE sync_id = $2
      `,
        [reason, syncId]
      );

      return {
        success: true,
        syncId,
        status: "cancelled",
        reason,
      };
    } catch (error) {
      throw new Error(`Failed to cancel sync: ${error.message}`);
    }
  }

  /**
   * Clean up old sync records
   * @param {number} daysToKeep - Number of days to keep records
   * @returns {Object} - Cleanup result
   */
  async cleanupOldSyncs(daysToKeep = 30) {
    try {
      const result = await db.query(
        `
        DELETE FROM sync_status 
        WHERE started_at < NOW() - INTERVAL '1 day' * $1
      `,
        [daysToKeep]
      );

      return {
        success: true,
        deletedRecords: result.rowCount,
      };
    } catch (error) {
      throw new Error(`Failed to cleanup old syncs: ${error.message}`);
    }
  }

  // Private helper methods

  async loadActiveSyncs() {
    // Load active syncs from Redis on startup
    try {
      const keys = await redisClient.keys("sync:*");
      for (const key of keys) {
        const data = await redisClient.get(key);
        if (data) {
          const syncData = JSON.parse(data);
          if (syncData.status === "running") {
            this.activeSyncs.set(syncData.syncId, syncData);
          }
        }
      }
    } catch (error) {
      console.warn("Failed to load active syncs from Redis:", error.message);
    }
  }

  async initializeMetrics() {
    // Initialize performance metrics from database
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_syncs,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_syncs,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_syncs,
          AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration
        FROM sync_status 
        WHERE started_at >= NOW() - INTERVAL '7 days'
          AND completed_at IS NOT NULL
      `);

      if (result.rows.length > 0) {
        const row = result.rows[0];
        this.syncMetrics.totalSyncs = parseInt(row.total_syncs) || 0;
        this.syncMetrics.successfulSyncs = parseInt(row.successful_syncs) || 0;
        this.syncMetrics.failedSyncs = parseInt(row.failed_syncs) || 0;
        this.syncMetrics.averageSyncTime = parseFloat(row.avg_duration) || 0;
      }
    } catch (error) {
      console.warn("Failed to initialize metrics:", error.message);
    }
  }

  async updateDatabaseSyncStatus(syncId, syncData) {
    await db.query(
      `
      UPDATE sync_status 
      SET 
        status = $1,
        completed_at = $2,
        processed_records = $3,
        successful_records = $4,
        failed_records = $5,
        sync_details = $6
      WHERE sync_id = $7
    `,
      [
        syncData.status,
        syncData.completedAt || null,
        syncData.completedChannels,
        syncData.successfulChannels,
        syncData.failedChannels,
        JSON.stringify(syncData),
        syncId,
      ]
    );
  }

  async updateSyncMetrics(syncData) {
    this.syncMetrics.totalSyncs++;

    if (syncData.status === "completed") {
      this.syncMetrics.successfulSyncs++;
    } else {
      this.syncMetrics.failedSyncs++;
    }

    if (syncData.duration) {
      this.syncMetrics.averageSyncTime =
        (this.syncMetrics.averageSyncTime * (this.syncMetrics.totalSyncs - 1) +
          syncData.duration) /
        this.syncMetrics.totalSyncs;
    }
  }
}

module.exports = SyncMonitoringService;
