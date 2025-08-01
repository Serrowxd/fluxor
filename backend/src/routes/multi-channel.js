const express = require("express");
const router = express.Router();
const MultiChannelService = require("../services/MultiChannelService");
const MultiChannelSyncJob = require("../jobs/MultiChannelSyncJob");
const { authenticateToken } = require("../middleware/auth");
const validation = require("../middleware/validation");
const { body, param, query } = require("express-validator");

const multiChannelService = new MultiChannelService();

/**
 * Multi-Channel Inventory Synchronization API Routes
 * Provides endpoints for managing multi-channel inventory sync
 */

// Initialize the service
multiChannelService.initialize().catch(console.error);

/**
 * @route GET /api/multi-channel/channels
 * @desc Get all active channels for a store
 * @access Private
 */
router.get("/channels", authenticateToken, async (req, res) => {
  try {
    const { storeId } = req.user; // Assuming user object has storeId
    const channels = await multiChannelService.getActiveChannels(storeId);

    res.json({
      success: true,
      channels,
    });
  } catch (error) {
    console.error("Get channels error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/multi-channel/channels/connect
 * @desc Connect a new channel
 * @access Private
 */
router.post(
  "/channels/connect",
  authenticateToken,
  [
    body("channelType")
      .isIn(["shopify", "amazon", "ebay", "square", "custom"])
      .withMessage("Invalid channel type"),
    body("credentials").isObject().withMessage("Credentials must be an object"),
  ],
  validation,
  async (req, res) => {
    try {
      const { storeId } = req.user;
      const { channelType, credentials } = req.body;

      const result = await multiChannelService.connectChannel(
        storeId,
        channelType,
        credentials
      );

      res.json({
        success: true,
        result,
      });
    } catch (error) {
      console.error("Connect channel error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route DELETE /api/multi-channel/channels/:channelId
 * @desc Disconnect a channel
 * @access Private
 */
router.delete(
  "/channels/:channelId",
  authenticateToken,
  [param("channelId").isUUID().withMessage("Invalid channel ID")],
  validation,
  async (req, res) => {
    try {
      const { storeId } = req.user;
      const { channelId } = req.params;

      const result = await multiChannelService.disconnectChannel(
        storeId,
        channelId
      );

      res.json({
        success: true,
        result,
      });
    } catch (error) {
      console.error("Disconnect channel error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route POST /api/multi-channel/sync/all
 * @desc Start sync across all channels
 * @access Private
 */
router.post(
  "/sync/all",
  authenticateToken,
  [body("options").optional().isObject()],
  validation,
  async (req, res) => {
    try {
      const { storeId } = req.user;
      const { options = {} } = req.body;

      // Add job to queue for async processing
      const job = await MultiChannelSyncJob.addJob(
        "multi-channel-sync",
        "sync-all-channels",
        {
          storeId,
          options,
        },
        {
          priority: "high",
        }
      );

      res.json({
        success: true,
        message: "Multi-channel sync started",
        jobId: job.id,
        estimatedDuration: "2-5 minutes",
      });
    } catch (error) {
      console.error("Sync all channels error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route POST /api/multi-channel/sync/channel/:channelId
 * @desc Start sync for a specific channel
 * @access Private
 */
router.post(
  "/sync/channel/:channelId",
  authenticateToken,
  [
    param("channelId").isUUID().withMessage("Invalid channel ID"),
    body("options").optional().isObject(),
  ],
  validation,
  async (req, res) => {
    try {
      const { storeId } = req.user;
      const { channelId } = req.params;
      const { options = {} } = req.body;

      // Add job to queue for async processing
      const job = await MultiChannelSyncJob.addJob(
        "multi-channel-sync",
        "sync-single-channel",
        {
          storeId,
          channelId,
          options,
        }
      );

      res.json({
        success: true,
        message: "Channel sync started",
        jobId: job.id,
        channelId,
        estimatedDuration: "30-60 seconds",
      });
    } catch (error) {
      console.error("Sync channel error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route GET /api/multi-channel/sync/status
 * @desc Get sync status for all channels
 * @access Private
 */
router.get("/sync/status", authenticateToken, async (req, res) => {
  try {
    const { storeId } = req.user;
    const syncStatus = await multiChannelService.getSyncStatus(storeId);

    res.json({
      success: true,
      syncStatus,
    });
  } catch (error) {
    console.error("Get sync status error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/multi-channel/conflicts
 * @desc Get pending conflicts
 * @access Private
 */
router.get("/conflicts", authenticateToken, async (req, res) => {
  try {
    const { storeId } = req.user;
    const conflicts = await multiChannelService.getPendingConflicts(storeId);

    res.json({
      success: true,
      conflicts,
    });
  } catch (error) {
    console.error("Get conflicts error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route POST /api/multi-channel/conflicts/:conflictId/resolve
 * @desc Resolve a specific conflict
 * @access Private
 */
router.post(
  "/conflicts/:conflictId/resolve",
  authenticateToken,
  [
    param("conflictId").isUUID().withMessage("Invalid conflict ID"),
    body("strategy")
      .isIn([
        "last_write_wins",
        "source_priority",
        "manual_review",
        "aggregate_approach",
        "conservative_approach",
      ])
      .withMessage("Invalid resolution strategy"),
  ],
  validation,
  async (req, res) => {
    try {
      const { userId } = req.user;
      const { conflictId } = req.params;
      const { strategy } = req.body;

      // Add job to queue for async processing
      const job = await MultiChannelSyncJob.addJob(
        "conflict-resolution",
        "resolve-conflict",
        {
          conflictId,
          strategy,
          userId,
        }
      );

      res.json({
        success: true,
        message: "Conflict resolution started",
        jobId: job.id,
        conflictId,
        strategy,
      });
    } catch (error) {
      console.error("Resolve conflict error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route POST /api/multi-channel/inventory/allocate/:productId
 * @desc Allocate inventory for a product across channels
 * @access Private
 */
router.post(
  "/inventory/allocate/:productId",
  authenticateToken,
  [
    param("productId").isUUID().withMessage("Invalid product ID"),
    body("strategy")
      .optional()
      .isIn([
        "equal_distribution",
        "priority_based",
        "performance_based",
        "demand_based",
        "custom_rules",
      ]),
    body("options").optional().isObject(),
  ],
  validation,
  async (req, res) => {
    try {
      const { productId } = req.params;
      const { strategy, options = {} } = req.body;

      if (strategy) {
        options.strategy = strategy;
      }

      // Add job to queue for async processing
      const job = await MultiChannelSyncJob.addJob(
        "inventory-allocation",
        "allocate-inventory",
        {
          productId,
          options,
        }
      );

      res.json({
        success: true,
        message: "Inventory allocation started",
        jobId: job.id,
        productId,
        strategy: strategy || "default",
      });
    } catch (error) {
      console.error("Allocate inventory error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route GET /api/multi-channel/inventory/allocation/:productId
 * @desc Get allocation summary for a product
 * @access Private
 */
router.get(
  "/inventory/allocation/:productId",
  authenticateToken,
  [param("productId").isUUID().withMessage("Invalid product ID")],
  validation,
  async (req, res) => {
    try {
      const { productId } = req.params;
      const allocationEngine = require("../services/InventoryAllocationEngine");
      const engine = new allocationEngine();

      const summary = await engine.getAllocationSummary(productId);

      res.json({
        success: true,
        allocation: summary,
      });
    } catch (error) {
      console.error("Get allocation summary error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route POST /api/multi-channel/inventory/reserve
 * @desc Reserve stock for an order
 * @access Private
 */
router.post(
  "/inventory/reserve",
  authenticateToken,
  [
    body("productId").isUUID().withMessage("Invalid product ID"),
    body("channelId").isUUID().withMessage("Invalid channel ID"),
    body("quantity")
      .isInt({ min: 1 })
      .withMessage("Quantity must be a positive integer"),
    body("orderId").notEmpty().withMessage("Order ID is required"),
  ],
  validation,
  async (req, res) => {
    try {
      const { productId, channelId, quantity, orderId } = req.body;
      const allocationEngine = require("../services/InventoryAllocationEngine");
      const engine = new allocationEngine();

      const result = await engine.reserveStock(
        productId,
        channelId,
        quantity,
        orderId
      );

      res.json({
        success: true,
        result,
      });
    } catch (error) {
      console.error("Reserve stock error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route POST /api/multi-channel/inventory/release
 * @desc Release reserved stock
 * @access Private
 */
router.post(
  "/inventory/release",
  authenticateToken,
  [
    body("productId").isUUID().withMessage("Invalid product ID"),
    body("channelId").isUUID().withMessage("Invalid channel ID"),
    body("quantity")
      .isInt({ min: 1 })
      .withMessage("Quantity must be a positive integer"),
    body("orderId").notEmpty().withMessage("Order ID is required"),
  ],
  validation,
  async (req, res) => {
    try {
      const { productId, channelId, quantity, orderId } = req.body;
      const allocationEngine = require("../services/InventoryAllocationEngine");
      const engine = new allocationEngine();

      const result = await engine.releaseReservedStock(
        productId,
        channelId,
        quantity,
        orderId
      );

      res.json({
        success: true,
        result,
      });
    } catch (error) {
      console.error("Release stock error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route POST /api/multi-channel/webhooks/:channelType
 * @desc Handle incoming webhooks from channels
 * @access Public (but with signature validation)
 */
router.post(
  "/webhooks/:channelType",
  [
    param("channelType")
      .isIn(["shopify", "amazon", "ebay", "square", "custom"])
      .withMessage("Invalid channel type"),
  ],
  validation,
  async (req, res) => {
    try {
      const { channelType } = req.params;
      const payload = req.body;
      const headers = req.headers;

      // Add job to queue for async processing
      const job = await MultiChannelSyncJob.addJob(
        "webhook-processing",
        "process-webhook",
        {
          channelType,
          payload,
          headers,
        },
        {
          priority: "normal",
          attempts: 2, // Fewer retries for webhooks
        }
      );

      // Respond quickly to webhook sender
      res.json({
        success: true,
        message: "Webhook received and queued for processing",
        jobId: job.id,
      });
    } catch (error) {
      console.error("Webhook processing error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route GET /api/multi-channel/queue/stats
 * @desc Get queue statistics
 * @access Private
 */
router.get("/queue/stats", authenticateToken, async (req, res) => {
  try {
    const stats = await MultiChannelSyncJob.getQueueStats();

    res.json({
      success: true,
      queueStats: stats,
    });
  } catch (error) {
    console.error("Get queue stats error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route GET /api/multi-channel/health
 * @desc Health check for multi-channel system
 * @access Private
 */
router.get("/health", authenticateToken, async (req, res) => {
  try {
    const { storeId } = req.user;
    const channels = await multiChannelService.getActiveChannels(storeId);
    const queueStats = await MultiChannelSyncJob.getQueueStats();

    const health = {
      status: "healthy",
      timestamp: new Date(),
      channels: {
        total: channels.length,
        connected: channels.filter((c) => c.credentials_valid).length,
        withErrors: channels.filter((c) => !c.credentials_valid).length,
      },
      queues: queueStats,
      services: {
        multiChannelService: "operational",
        allocationEngine: "operational",
        conflictResolver: "operational",
      },
    };

    res.json({
      success: true,
      health,
    });
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      health: {
        status: "unhealthy",
        timestamp: new Date(),
      },
    });
  }
});

module.exports = router;
