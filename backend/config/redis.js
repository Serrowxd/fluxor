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

// Chat system queues
const chatContextQueue = new Queue("chat-context", process.env.REDIS_URL);
const chatAnalyticsQueue = new Queue("chat-analytics", process.env.REDIS_URL);

// Chat caching configuration
const CHAT_CACHE_TTL = {
  CONTEXT: 300, // 5 minutes for chat context
  CONVERSATION: 3600, // 1 hour for conversation history
  USER_STATS: 86400, // 24 hours for user analytics
};

// Chat caching helper functions
const chatCache = {
  async setContext(userId, storeId, context) {
    const key = `chat:context:${userId}:${storeId}`;
    await redisClient.setEx(key, CHAT_CACHE_TTL.CONTEXT, JSON.stringify(context));
  },

  async getContext(userId, storeId) {
    const key = `chat:context:${userId}:${storeId}`;
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  },

  async setConversation(conversationId, messages) {
    const key = `chat:conversation:${conversationId}`;
    await redisClient.setEx(key, CHAT_CACHE_TTL.CONVERSATION, JSON.stringify(messages));
  },

  async getConversation(conversationId) {
    const key = `chat:conversation:${conversationId}`;
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  },

  async invalidateConversation(conversationId) {
    const key = `chat:conversation:${conversationId}`;
    await redisClient.del(key);
  },

  async setUserStats(userId, stats) {
    const key = `chat:stats:${userId}`;
    await redisClient.setEx(key, CHAT_CACHE_TTL.USER_STATS, JSON.stringify(stats));
  },

  async getUserStats(userId) {
    const key = `chat:stats:${userId}`;
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  },

  async incrementUserRequests(userId) {
    const dayKey = `chat:requests:${userId}:${new Date().toISOString().split('T')[0]}`;
    const minuteKey = `chat:requests:${userId}:minute:${Math.floor(Date.now() / 60000)}`;
    
    await redisClient.incr(dayKey);
    await redisClient.expire(dayKey, 86400); // Expire after 24 hours
    
    await redisClient.incr(minuteKey);
    await redisClient.expire(minuteKey, 60); // Expire after 1 minute
  },

  async getUserRequestCounts(userId) {
    const dayKey = `chat:requests:${userId}:${new Date().toISOString().split('T')[0]}`;
    const minuteKey = `chat:requests:${userId}:minute:${Math.floor(Date.now() / 60000)}`;
    
    const [daily, perMinute] = await Promise.all([
      redisClient.get(dayKey),
      redisClient.get(minuteKey)
    ]);

    return {
      daily: parseInt(daily || '0'),
      perMinute: parseInt(perMinute || '0')
    };
  }
};

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
  // Chat system queues
  chatContextQueue,
  chatAnalyticsQueue,
  // Chat caching utilities
  chatCache,
  CHAT_CACHE_TTL,
};
