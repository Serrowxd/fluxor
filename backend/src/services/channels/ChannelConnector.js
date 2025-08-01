const { v4: uuidv4 } = require("uuid");

/**
 * Abstract base class for all channel connectors
 * Provides standardized interface for multi-channel inventory synchronization
 */
class ChannelConnector {
  constructor(channelConfig) {
    if (this.constructor === ChannelConnector) {
      throw new Error(
        "ChannelConnector is abstract and cannot be instantiated"
      );
    }
    this.channelConfig = channelConfig;
    this.channelId = channelConfig.channel_id;
    this.channelType = channelConfig.channel_type;
    this.configuration = channelConfig.configuration || {};
    this.rateLimitPerMinute = channelConfig.rate_limit_per_minute || 60;
    this.retryAttempts = channelConfig.retry_attempts || 3;
  }

  /**
   * Abstract methods that must be implemented by concrete connectors
   */
  async authenticate(credentials) {
    throw new Error("authenticate() must be implemented by subclass");
  }

  async syncInventory(request) {
    throw new Error("syncInventory() must be implemented by subclass");
  }

  async processWebhook(payload) {
    throw new Error("processWebhook() must be implemented by subclass");
  }

  async getOrders(filter) {
    throw new Error("getOrders() must be implemented by subclass");
  }

  async updateInventory(updates) {
    throw new Error("updateInventory() must be implemented by subclass");
  }

  /**
   * Common functionality implemented in base class
   */
  async healthCheck() {
    try {
      const startTime = Date.now();
      const response = await this.makeTestRequest();
      const latency = Date.now() - startTime;

      return {
        status: "healthy",
        latency,
        lastCheck: new Date(),
        channelType: this.channelType,
      };
    } catch (error) {
      return {
        status: "unhealthy",
        error: error.message,
        lastCheck: new Date(),
        channelType: this.channelType,
      };
    }
  }

  async makeTestRequest() {
    // Default implementation - can be overridden by subclasses
    return { success: true, duration: 0 };
  }

  getRateLimits() {
    return {
      perMinute: this.rateLimitPerMinute,
      perSecond: Math.floor(this.rateLimitPerMinute / 60),
      burstLimit: Math.floor(this.rateLimitPerMinute / 4), // 25% of minute limit as burst
    };
  }

  getCapabilities() {
    // Default capabilities - should be overridden by subclasses
    return [
      { name: "inventory_sync", supported: true },
      { name: "order_sync", supported: true },
      { name: "webhook_support", supported: false },
      { name: "bulk_operations", supported: false },
    ];
  }

  /**
   * Rate limiting and retry logic
   */
  async handleRateLimit(error) {
    const retryAfter = this.extractRetryAfter(error);
    if (retryAfter > 0) {
      await this.delay(retryAfter * 1000);
    }
  }

  extractRetryAfter(error) {
    // Extract retry-after value from error response
    if (error.response && error.response.headers) {
      const retryAfter = error.response.headers["retry-after"];
      if (retryAfter) {
        return parseInt(retryAfter, 10);
      }
    }
    return 60; // Default 60 second wait
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Batch processing utilities
   */
  createBatches(items, batchSize = 100) {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Error handling utilities
   */
  createError(type, message, details = {}) {
    const error = new Error(message);
    error.type = type;
    error.channelType = this.channelType;
    error.channelId = this.channelId;
    error.details = details;
    error.timestamp = new Date();
    return error;
  }

  /**
   * Validation utilities
   */
  validateSyncRequest(request) {
    if (!request || typeof request !== "object") {
      throw this.createError("VALIDATION_ERROR", "Invalid sync request format");
    }

    if (!Array.isArray(request.updates)) {
      throw this.createError("VALIDATION_ERROR", "Updates must be an array");
    }

    for (const update of request.updates) {
      this.validateInventoryUpdate(update);
    }

    return true;
  }

  validateInventoryUpdate(update) {
    const required = ["productId", "quantity"];
    for (const field of required) {
      if (!(field in update)) {
        throw this.createError(
          "VALIDATION_ERROR",
          `Missing required field: ${field}`
        );
      }
    }

    if (typeof update.quantity !== "number" || update.quantity < 0) {
      throw this.createError(
        "VALIDATION_ERROR",
        "Quantity must be a non-negative number"
      );
    }

    return true;
  }

  /**
   * Webhook validation utilities
   */
  validateWebhookSignature(payload, signature, secret) {
    // Default implementation - should be overridden by specific connectors
    return true;
  }

  /**
   * Standardized response formatters
   */
  formatSyncResult(
    totalProcessed,
    successful,
    failed,
    errors = [],
    duration = 0
  ) {
    return {
      totalProcessed,
      successful,
      failed,
      errors,
      duration,
      timestamp: new Date(),
      channelType: this.channelType,
      channelId: this.channelId,
    };
  }

  formatOrder(rawOrder) {
    // Default order format - should be overridden by specific connectors
    return {
      orderId: rawOrder.id,
      channelOrderId: rawOrder.channel_order_id,
      customerInfo: rawOrder.customer,
      items: rawOrder.line_items || [],
      total: rawOrder.total_price,
      currency: rawOrder.currency,
      status: rawOrder.status,
      createdAt: new Date(rawOrder.created_at),
      updatedAt: new Date(rawOrder.updated_at),
    };
  }

  /**
   * Logging utilities
   */
  log(level, message, meta = {}) {
    const logData = {
      level,
      message,
      channelType: this.channelType,
      channelId: this.channelId,
      timestamp: new Date(),
      ...meta,
    };

    // In a real implementation, this would use a proper logging service
    console.log(`[${level.toUpperCase()}] ${this.channelType}:`, logData);
  }

  logError(error, context = {}) {
    this.log("error", error.message, {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        type: error.type,
      },
      context,
    });
  }

  logInfo(message, meta = {}) {
    this.log("info", message, meta);
  }

  logWarning(message, meta = {}) {
    this.log("warn", message, meta);
  }
}

module.exports = ChannelConnector;
