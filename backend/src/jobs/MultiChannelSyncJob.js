const {
  multiChannelSyncQueue,
  inventoryAllocationQueue,
  conflictResolutionQueue,
  webhookProcessingQueue,
  amazonSyncQueue,
  ebaySyncQueue,
  squareSyncQueue,
  customApiSyncQueue,
} = require("../../config/redis");

const MultiChannelService = require("../services/MultiChannelService");
const InventoryAllocationEngine = require("../services/InventoryAllocationEngine");
const ConflictResolutionEngine = require("../services/ConflictResolutionEngine");

/**
 * Background job processors for multi-channel synchronization
 * Handles queue processing for all multi-channel operations
 */
class MultiChannelSyncJob {
  constructor() {
    this.multiChannelService = new MultiChannelService();
    this.allocationEngine = new InventoryAllocationEngine();
    this.conflictResolver = new ConflictResolutionEngine();

    this.setupProcessors();
  }

  /**
   * Initialize all queue processors
   */
  setupProcessors() {
    // Multi-channel sync processor
    multiChannelSyncQueue.process(
      "sync-all-channels",
      5,
      this.processMultiChannelSync.bind(this)
    );
    multiChannelSyncQueue.process(
      "sync-single-channel",
      10,
      this.processSingleChannelSync.bind(this)
    );

    // Inventory allocation processor
    inventoryAllocationQueue.process(
      "allocate-inventory",
      10,
      this.processInventoryAllocation.bind(this)
    );
    inventoryAllocationQueue.process(
      "reallocate-inventory",
      15,
      this.processInventoryReallocation.bind(this)
    );

    // Conflict resolution processor
    conflictResolutionQueue.process(
      "resolve-conflict",
      5,
      this.processConflictResolution.bind(this)
    );
    conflictResolutionQueue.process(
      "detect-conflicts",
      3,
      this.processConflictDetection.bind(this)
    );

    // Webhook processing
    webhookProcessingQueue.process(
      "process-webhook",
      20,
      this.processWebhook.bind(this)
    );

    // Channel-specific processors
    amazonSyncQueue.process(
      "amazon-inventory-sync",
      3,
      this.processAmazonSync.bind(this)
    );
    ebaySyncQueue.process(
      "ebay-inventory-sync",
      5,
      this.processEbaySync.bind(this)
    );
    squareSyncQueue.process(
      "square-inventory-sync",
      8,
      this.processSquareSync.bind(this)
    );
    customApiSyncQueue.process(
      "custom-api-sync",
      5,
      this.processCustomApiSync.bind(this)
    );

    this.setupErrorHandlers();
    this.setupCompletionHandlers();
  }

  /**
   * Process multi-channel sync for all channels
   */
  async processMultiChannelSync(job) {
    const { storeId, options = {} } = job.data;

    try {
      job.progress(0);

      console.log(`Starting multi-channel sync for store: ${storeId}`);

      // Initialize services if needed
      await this.multiChannelService.initialize();

      job.progress(10);

      // Perform sync
      const result = await this.multiChannelService.syncInventoryAllChannels(
        storeId,
        options
      );

      job.progress(80);

      // Check for conflicts after sync
      if (result.conflicts > 0) {
        await conflictResolutionQueue.add(
          "detect-conflicts",
          {
            storeId,
            syncId: result.syncId,
          },
          {
            delay: 5000, // Wait 5 seconds after sync to detect conflicts
            priority: "high",
          }
        );
      }

      job.progress(100);

      console.log(`Multi-channel sync completed for store: ${storeId}`, result);

      return {
        success: true,
        storeId,
        syncId: result.syncId,
        results: result,
      };
    } catch (error) {
      console.error(`Multi-channel sync failed for store: ${storeId}`, error);
      throw error;
    }
  }

  /**
   * Process sync for a single channel
   */
  async processSingleChannelSync(job) {
    const { storeId, channelId, options = {} } = job.data;

    try {
      job.progress(0);

      console.log(
        `Starting single channel sync: ${channelId} for store: ${storeId}`
      );

      await this.multiChannelService.initialize();

      job.progress(20);

      const result = await this.multiChannelService.syncChannelInventory(
        storeId,
        channelId,
        options
      );

      job.progress(100);

      console.log(`Single channel sync completed: ${channelId}`, result);

      return {
        success: true,
        storeId,
        channelId,
        result,
      };
    } catch (error) {
      console.error(`Single channel sync failed: ${channelId}`, error);
      throw error;
    }
  }

  /**
   * Process inventory allocation
   */
  async processInventoryAllocation(job) {
    const { productId, options = {} } = job.data;

    try {
      job.progress(0);

      console.log(`Starting inventory allocation for product: ${productId}`);

      await this.allocationEngine.initialize();

      job.progress(30);

      const result = await this.allocationEngine.allocateInventory(
        productId,
        options
      );

      job.progress(100);

      console.log(
        `Inventory allocation completed for product: ${productId}`,
        result
      );

      return {
        success: true,
        productId,
        result,
      };
    } catch (error) {
      console.error(
        `Inventory allocation failed for product: ${productId}`,
        error
      );
      throw error;
    }
  }

  /**
   * Process inventory reallocation
   */
  async processInventoryReallocation(job) {
    const { productId, newStockLevel, options = {} } = job.data;

    try {
      job.progress(0);

      console.log(
        `Starting inventory reallocation for product: ${productId}, new stock: ${newStockLevel}`
      );

      await this.allocationEngine.initialize();

      job.progress(30);

      const result = await this.allocationEngine.reallocateInventory(
        productId,
        newStockLevel,
        options
      );

      job.progress(100);

      console.log(
        `Inventory reallocation completed for product: ${productId}`,
        result
      );

      return {
        success: true,
        productId,
        newStockLevel,
        result,
      };
    } catch (error) {
      console.error(
        `Inventory reallocation failed for product: ${productId}`,
        error
      );
      throw error;
    }
  }

  /**
   * Process conflict resolution
   */
  async processConflictResolution(job) {
    const { conflictId, strategy, userId } = job.data;

    try {
      job.progress(0);

      console.log(
        `Starting conflict resolution: ${conflictId} with strategy: ${strategy}`
      );

      await this.conflictResolver.initialize();

      job.progress(40);

      const result = await this.multiChannelService.resolveConflict(
        conflictId,
        strategy,
        userId
      );

      job.progress(100);

      console.log(`Conflict resolution completed: ${conflictId}`, result);

      return {
        success: true,
        conflictId,
        strategy,
        result,
      };
    } catch (error) {
      console.error(`Conflict resolution failed: ${conflictId}`, error);
      throw error;
    }
  }

  /**
   * Process conflict detection
   */
  async processConflictDetection(job) {
    const { storeId, syncId } = job.data;

    try {
      job.progress(0);

      console.log(`Starting conflict detection for store: ${storeId}`);

      await this.conflictResolver.initialize();

      job.progress(30);

      const conflicts = await this.conflictResolver.detectStoreConflicts(
        storeId
      );

      job.progress(80);

      // Auto-resolve conflicts that can be automatically handled
      for (const conflict of conflicts) {
        if (conflict.priority === "low" || conflict.priority === "medium") {
          try {
            await this.conflictResolver.autoResolve(conflict);
          } catch (error) {
            console.warn(
              `Auto-resolution failed for conflict: ${conflict.conflictId}`,
              error
            );
          }
        }
      }

      job.progress(100);

      console.log(`Conflict detection completed for store: ${storeId}`, {
        totalConflicts: conflicts.length,
        criticalConflicts: conflicts.filter((c) => c.priority === "critical")
          .length,
      });

      return {
        success: true,
        storeId,
        syncId,
        conflicts: conflicts.length,
        criticalConflicts: conflicts.filter((c) => c.priority === "critical")
          .length,
      };
    } catch (error) {
      console.error(`Conflict detection failed for store: ${storeId}`, error);
      throw error;
    }
  }

  /**
   * Process webhook
   */
  async processWebhook(job) {
    const { channelType, payload, headers } = job.data;

    try {
      job.progress(0);

      console.log(`Processing webhook from ${channelType}`);

      await this.multiChannelService.initialize();

      job.progress(40);

      const result = await this.multiChannelService.handleWebhook(
        channelType,
        payload,
        headers
      );

      job.progress(100);

      console.log(`Webhook processed from ${channelType}`, result);

      return {
        success: true,
        channelType,
        result,
      };
    } catch (error) {
      console.error(`Webhook processing failed from ${channelType}`, error);
      throw error;
    }
  }

  /**
   * Process Amazon-specific sync
   */
  async processAmazonSync(job) {
    return this.processChannelSpecificSync(job, "amazon");
  }

  /**
   * Process eBay-specific sync
   */
  async processEbaySync(job) {
    return this.processChannelSpecificSync(job, "ebay");
  }

  /**
   * Process Square-specific sync
   */
  async processSquareSync(job) {
    return this.processChannelSpecificSync(job, "square");
  }

  /**
   * Process Custom API-specific sync
   */
  async processCustomApiSync(job) {
    return this.processChannelSpecificSync(job, "custom");
  }

  /**
   * Generic channel-specific sync processor
   */
  async processChannelSpecificSync(job, channelType) {
    const { storeId, channelId, operation, data } = job.data;

    try {
      job.progress(0);

      console.log(
        `Starting ${channelType} specific sync: ${operation} for store: ${storeId}`
      );

      await this.multiChannelService.initialize();

      job.progress(30);

      let result;
      switch (operation) {
        case "inventory-sync":
          result = await this.multiChannelService.syncChannelInventory(
            storeId,
            channelId,
            data.options
          );
          break;
        case "order-fetch":
          // Get channel connector and fetch orders
          result = await this.fetchChannelOrders(
            storeId,
            channelId,
            data.filter
          );
          break;
        case "product-sync":
          result = await this.syncChannelProducts(
            storeId,
            channelId,
            data.products
          );
          break;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      job.progress(100);

      console.log(
        `${channelType} specific sync completed: ${operation}`,
        result
      );

      return {
        success: true,
        storeId,
        channelId,
        channelType,
        operation,
        result,
      };
    } catch (error) {
      console.error(`${channelType} specific sync failed: ${operation}`, error);
      throw error;
    }
  }

  /**
   * Fetch orders from a specific channel
   */
  async fetchChannelOrders(storeId, channelId, filter) {
    // This would implement channel-specific order fetching
    // For now, return placeholder
    return {
      orders: [],
      totalCount: 0,
      message: "Order fetching not yet implemented",
    };
  }

  /**
   * Sync products to a specific channel
   */
  async syncChannelProducts(storeId, channelId, products) {
    // This would implement channel-specific product syncing
    // For now, return placeholder
    return {
      syncedProducts: products.length,
      message: "Product syncing not yet implemented",
    };
  }

  /**
   * Setup error handlers for all queues
   */
  setupErrorHandlers() {
    const queues = [
      multiChannelSyncQueue,
      inventoryAllocationQueue,
      conflictResolutionQueue,
      webhookProcessingQueue,
      amazonSyncQueue,
      ebaySyncQueue,
      squareSyncQueue,
      customApiSyncQueue,
    ];

    queues.forEach((queue) => {
      queue.on("failed", (job, err) => {
        console.error(`Job failed in queue ${queue.name}:`, {
          jobId: job.id,
          jobData: job.data,
          error: err.message,
          stack: err.stack,
        });
      });

      queue.on("stalled", (job) => {
        console.warn(`Job stalled in queue ${queue.name}:`, {
          jobId: job.id,
          jobData: job.data,
        });
      });
    });
  }

  /**
   * Setup completion handlers for monitoring
   */
  setupCompletionHandlers() {
    const queues = [
      multiChannelSyncQueue,
      inventoryAllocationQueue,
      conflictResolutionQueue,
      webhookProcessingQueue,
      amazonSyncQueue,
      ebaySyncQueue,
      squareSyncQueue,
      customApiSyncQueue,
    ];

    queues.forEach((queue) => {
      queue.on("completed", (job, result) => {
        console.log(`Job completed in queue ${queue.name}:`, {
          jobId: job.id,
          duration: Date.now() - job.timestamp,
          result: result.success ? "success" : "failed",
        });
      });
    });
  }

  /**
   * Add job to appropriate queue
   */
  static async addJob(queueName, jobType, data, options = {}) {
    const queueMap = {
      "multi-channel-sync": multiChannelSyncQueue,
      "inventory-allocation": inventoryAllocationQueue,
      "conflict-resolution": conflictResolutionQueue,
      "webhook-processing": webhookProcessingQueue,
      "amazon-sync": amazonSyncQueue,
      "ebay-sync": ebaySyncQueue,
      "square-sync": squareSyncQueue,
      "custom-api-sync": customApiSyncQueue,
    };

    const queue = queueMap[queueName];
    if (!queue) {
      throw new Error(`Unknown queue: ${queueName}`);
    }

    const jobOptions = {
      attempts: 3,
      backoff: "exponential",
      removeOnComplete: 100,
      removeOnFail: 50,
      ...options,
    };

    return queue.add(jobType, data, jobOptions);
  }

  /**
   * Get queue statistics
   */
  static async getQueueStats() {
    const queueNames = [
      "multi-channel-sync",
      "inventory-allocation",
      "conflict-resolution",
      "webhook-processing",
      "amazon-sync",
      "ebay-sync",
      "square-sync",
      "custom-api-sync",
    ];

    const stats = {};

    for (const queueName of queueNames) {
      const queueMap = {
        "multi-channel-sync": multiChannelSyncQueue,
        "inventory-allocation": inventoryAllocationQueue,
        "conflict-resolution": conflictResolutionQueue,
        "webhook-processing": webhookProcessingQueue,
        "amazon-sync": amazonSyncQueue,
        "ebay-sync": ebaySyncQueue,
        "square-sync": squareSyncQueue,
        "custom-api-sync": customApiSyncQueue,
      };

      const queue = queueMap[queueName];
      if (queue) {
        stats[queueName] = {
          waiting: await queue.getWaiting().then((jobs) => jobs.length),
          active: await queue.getActive().then((jobs) => jobs.length),
          completed: await queue.getCompleted().then((jobs) => jobs.length),
          failed: await queue.getFailed().then((jobs) => jobs.length),
        };
      }
    }

    return stats;
  }
}

module.exports = MultiChannelSyncJob;
