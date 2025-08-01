const { createClient } = require("redis");
const Queue = require("bull");
require("dotenv").config();

// Redis client for general caching
const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on("error", (err) => {
  console.error("Redis Client Error", err);
});

redisClient.on("connect", () => {
  console.log("Redis connected successfully");
});

// Initialize Redis connection
(async () => {
  await redisClient.connect();
})();

// Bull queues for background jobs
const shopifySyncQueue = new Queue("shopify-sync", process.env.REDIS_URL);
const forecastQueue = new Queue("forecast", process.env.REDIS_URL);
const alertQueue = new Queue("alerts", process.env.REDIS_URL);

// Multi-channel sync queues (Ticket #3)
const multiChannelSyncQueue = new Queue(
  "multi-channel-sync",
  process.env.REDIS_URL
);
const inventoryAllocationQueue = new Queue(
  "inventory-allocation",
  process.env.REDIS_URL
);
const conflictResolutionQueue = new Queue(
  "conflict-resolution",
  process.env.REDIS_URL
);
const webhookProcessingQueue = new Queue(
  "webhook-processing",
  process.env.REDIS_URL
);

// Channel-specific queues
const amazonSyncQueue = new Queue("amazon-sync", process.env.REDIS_URL);
const ebaySyncQueue = new Queue("ebay-sync", process.env.REDIS_URL);
const squareSyncQueue = new Queue("square-sync", process.env.REDIS_URL);
const customApiSyncQueue = new Queue("custom-api-sync", process.env.REDIS_URL);

// Supplier and Purchase Order queues (Ticket #4)
const supplierManagementQueue = new Queue(
  "supplier-management",
  process.env.REDIS_URL
);
const purchaseOrderQueue = new Queue("purchase-order", process.env.REDIS_URL);
const reorderPointQueue = new Queue("reorder-point", process.env.REDIS_URL);
const approvalWorkflowQueue = new Queue(
  "approval-workflow",
  process.env.REDIS_URL
);
const supplierCommunicationQueue = new Queue(
  "supplier-communication",
  process.env.REDIS_URL
);
const automatedReorderQueue = new Queue(
  "automated-reorder",
  process.env.REDIS_URL
);
const supplierPerformanceQueue = new Queue(
  "supplier-performance",
  process.env.REDIS_URL
);

module.exports = {
  redisClient,
  // Original queues
  shopifySyncQueue,
  forecastQueue,
  alertQueue,
  // Multi-channel queues
  multiChannelSyncQueue,
  inventoryAllocationQueue,
  conflictResolutionQueue,
  webhookProcessingQueue,
  // Channel-specific queues
  amazonSyncQueue,
  ebaySyncQueue,
  squareSyncQueue,
  customApiSyncQueue,
  // Supplier and Purchase Order queues
  supplierManagementQueue,
  purchaseOrderQueue,
  reorderPointQueue,
  approvalWorkflowQueue,
  supplierCommunicationQueue,
  automatedReorderQueue,
  supplierPerformanceQueue,
};
