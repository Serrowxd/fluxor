const ChannelConnector = require("../ChannelConnector");
const crypto = require("crypto");
const axios = require("axios");

/**
 * Custom REST API connector for inventory synchronization
 * Handles generic REST API integration with configurable endpoints and authentication
 */
class CustomApiConnector extends ChannelConnector {
  constructor(channelConfig, credentials) {
    super(channelConfig);
    this.baseUrl = credentials.base_url;
    this.authType = credentials.auth_type || "bearer"; // bearer, api_key, basic, none
    this.apiKey = credentials.api_key;
    this.bearerToken = credentials.bearer_token;
    this.username = credentials.username;
    this.password = credentials.password;

    // Custom API configuration from channel config
    this.endpoints =
      channelConfig.configuration?.endpoints || this.getDefaultEndpoints();
    this.authConfig = channelConfig.configuration?.auth || {};
    this.mappings =
      channelConfig.configuration?.mappings || this.getDefaultMappings();

    // Rate limiting - configurable
    this.rateLimitPerMinute = channelConfig.rate_limit_per_minute || 60;
    this.maxRetries = channelConfig.retry_attempts || 3;
  }

  getCapabilities() {
    return [
      { name: "inventory_sync", supported: true },
      { name: "order_sync", supported: true },
      { name: "webhook_support", supported: true },
      { name: "bulk_operations", supported: true },
      { name: "real_time_updates", supported: true },
      { name: "product_sync", supported: true },
      { name: "price_sync", supported: true },
    ];
  }

  /**
   * Authenticate with custom API
   */
  async authenticate(credentials) {
    try {
      const testEndpoint =
        this.endpoints.health || this.endpoints.auth || "/health";
      const response = await this.makeApiRequest("GET", testEndpoint);

      this.logInfo("Custom API authentication successful", {
        baseUrl: this.baseUrl,
        authType: this.authType,
      });

      return {
        success: true,
        apiInfo: {
          baseUrl: this.baseUrl,
          authType: this.authType,
          version: response.version || "unknown",
          status: response.status || "connected",
        },
      };
    } catch (error) {
      this.logError(error, { context: "authentication" });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Sync inventory for products using custom API
   */
  async syncInventory(request) {
    const startTime = Date.now();
    this.validateSyncRequest(request);

    const results = this.formatSyncResult(0, 0, 0, [], 0);

    try {
      this.logInfo("Starting custom API inventory sync", {
        productCount: request.updates.length,
        storeId: request.storeId,
        endpoint: this.endpoints.inventory,
      });

      // Check if API supports batch operations
      const supportsBatch =
        this.endpoints.inventoryBatch && request.updates.length > 1;

      if (supportsBatch) {
        await this.processBatchUpdate(request.updates, results);
      } else {
        // Process individually
        const batches = this.createBatches(request.updates, 10); // Smaller batches for individual updates

        for (const batch of batches) {
          await this.processBatch(batch, results);

          // Rate limiting
          if (batches.indexOf(batch) < batches.length - 1) {
            await this.delay(1000); // 1 second between batches
          }

          results.totalProcessed += batch.length;
        }
      }

      results.duration = Date.now() - startTime;

      this.logInfo("Custom API inventory sync completed", {
        totalProcessed: results.totalProcessed,
        successful: results.successful,
        failed: results.failed,
        duration: results.duration,
      });

      return results;
    } catch (error) {
      this.logError(error, { context: "sync_inventory" });
      throw this.createError(
        "SYNC_ERROR",
        `Custom API sync failed: ${error.message}`
      );
    }
  }

  /**
   * Process batch update using batch endpoint
   */
  async processBatchUpdate(updates, results) {
    try {
      const requestData = {
        updates: updates.map((update) => this.mapInventoryUpdate(update)),
      };

      const response = await this.makeApiRequest(
        "POST",
        this.endpoints.inventoryBatch,
        requestData
      );

      // Parse batch response
      if (response.results) {
        response.results.forEach((result, index) => {
          if (result.success || result.status === "success") {
            results.successful++;
          } else {
            results.failed++;
            results.errors.push({
              productId: updates[index].productId,
              error: result.error || result.message || "Unknown error",
            });
          }
        });
      } else {
        // Assume success if no detailed results
        results.successful += updates.length;
      }

      results.totalProcessed += updates.length;
    } catch (error) {
      results.failed += updates.length;
      results.errors.push({
        batch: updates.map((u) => u.productId),
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Process a batch of individual inventory updates
   */
  async processBatch(batch, results) {
    for (const update of batch) {
      try {
        await this.updateSingleProduct(update);
        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          productId: update.productId,
          sku: update.sku,
          error: error.message,
        });

        this.logError(error, {
          context: "single_product_update",
          productId: update.productId,
        });
      }
    }
  }

  /**
   * Update inventory for a single product
   */
  async updateSingleProduct(update) {
    try {
      const endpoint = this.endpoints.inventory.replace(
        "{id}",
        update.externalProductId
      );
      const requestData = this.mapInventoryUpdate(update);

      const method = this.endpoints.inventoryMethod || "PUT";
      await this.makeApiRequest(method, endpoint, requestData);

      this.logInfo("Product inventory updated successfully", {
        productId: update.productId,
        externalProductId: update.externalProductId,
        quantity: update.quantity,
      });
    } catch (error) {
      throw new Error(
        `Failed to update product ${update.externalProductId}: ${error.message}`
      );
    }
  }

  /**
   * Get orders from custom API
   */
  async getOrders(filter) {
    try {
      const params = new URLSearchParams();

      if (filter.since) {
        const sinceParam =
          this.mappings.orders?.filters?.since || "created_after";
        params.append(sinceParam, filter.since);
      }

      if (filter.status) {
        const statusParam = this.mappings.orders?.filters?.status || "status";
        params.append(statusParam, filter.status);
      }

      const limitParam = this.mappings.orders?.filters?.limit || "limit";
      params.append(limitParam, filter.limit || 50);

      const endpoint = `${this.endpoints.orders}?${params.toString()}`;
      const response = await this.makeApiRequest("GET", endpoint);

      // Map response to standard format
      const ordersData = this.extractOrdersFromResponse(response);
      return ordersData.map((order) => this.formatOrder(order));
    } catch (error) {
      throw this.createError(
        "ORDER_FETCH_ERROR",
        `Failed to get orders: ${error.message}`
      );
    }
  }

  /**
   * Process incoming webhook from custom API
   */
  async processWebhook(payload) {
    try {
      const eventType = this.extractEventType(payload);

      switch (eventType) {
        case "order.created":
        case "order_created":
          return await this.handleOrderCreated(payload);
        case "order.updated":
        case "order_updated":
          return await this.handleOrderUpdated(payload);
        case "inventory.updated":
        case "inventory_updated":
          return await this.handleInventoryUpdated(payload);
        case "product.updated":
        case "product_updated":
          return await this.handleProductUpdated(payload);
        default:
          this.logWarning("Unknown webhook event type", { type: eventType });
          return {
            type: "unknown",
            processed: false,
            message: `Unknown event type: ${eventType}`,
          };
      }
    } catch (error) {
      this.logError(error, { context: "webhook_processing" });
      throw this.createError(
        "WEBHOOK_ERROR",
        `Failed to process webhook: ${error.message}`
      );
    }
  }

  /**
   * Validate webhook signature for custom API
   */
  validateWebhookSignature(payload, signature, secret) {
    try {
      const signatureType =
        this.authConfig.webhookSignatureType || "hmac-sha256";
      const body =
        typeof payload === "string" ? payload : JSON.stringify(payload);

      switch (signatureType) {
        case "hmac-sha256":
          const hmac = crypto.createHmac("sha256", secret);
          hmac.update(body);
          const computedSignature = hmac.digest("hex");
          return (
            signature === computedSignature ||
            signature === `sha256=${computedSignature}`
          );

        case "hmac-sha1":
          const hmacSha1 = crypto.createHmac("sha1", secret);
          hmacSha1.update(body);
          const computedSha1 = hmacSha1.digest("hex");
          return (
            signature === computedSha1 || signature === `sha1=${computedSha1}`
          );

        case "none":
          return true;

        default:
          this.logWarning("Unknown signature type", { type: signatureType });
          return false;
      }
    } catch (error) {
      this.logError(error, { context: "webhook_signature_validation" });
      return false;
    }
  }

  /**
   * Make authenticated API request to custom API
   */
  async makeApiRequest(method, endpoint, data = null) {
    const url = endpoint.startsWith("http")
      ? endpoint
      : `${this.baseUrl}${endpoint}`;
    const headers = await this.buildHeaders();

    const config = {
      method,
      url,
      headers,
      timeout: 30000,
    };

    if (data && (method === "POST" || method === "PUT" || method === "PATCH")) {
      config.data = data;
    }

    let retryCount = 0;

    while (retryCount < this.maxRetries) {
      try {
        const response = await axios(config);
        return response.data;
      } catch (error) {
        if (error.response) {
          const status = error.response.status;

          // Handle rate limiting
          if (status === 429) {
            const retryAfter = error.response.headers["retry-after"] || 2;
            this.logWarning("Rate limit hit, retrying", {
              retryAfter,
              attempt: retryCount + 1,
            });
            await this.delay(parseInt(retryAfter) * 1000);
            retryCount++;
            continue;
          }

          // Handle other HTTP errors
          if (status >= 400) {
            const errorMessage =
              error.response.data?.message ||
              error.response.data?.error ||
              error.message;
            throw new Error(`Custom API error (${status}): ${errorMessage}`);
          }
        }

        // Network or other errors
        if (retryCount < this.maxRetries - 1) {
          this.logWarning("Request failed, retrying", {
            error: error.message,
            attempt: retryCount + 1,
          });
          await this.delay(Math.pow(2, retryCount) * 1000); // Exponential backoff
          retryCount++;
          continue;
        }

        throw error;
      }
    }
  }

  /**
   * Build authentication headers based on auth type
   */
  async buildHeaders() {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "InventoryManager/1.0",
    };

    switch (this.authType) {
      case "bearer":
        if (this.bearerToken) {
          headers["Authorization"] = `Bearer ${this.bearerToken}`;
        }
        break;

      case "api_key":
        if (this.apiKey) {
          const keyHeader = this.authConfig.apiKeyHeader || "X-API-Key";
          headers[keyHeader] = this.apiKey;
        }
        break;

      case "basic":
        if (this.username && this.password) {
          const credentials = Buffer.from(
            `${this.username}:${this.password}`
          ).toString("base64");
          headers["Authorization"] = `Basic ${credentials}`;
        }
        break;

      case "none":
        // No authentication required
        break;

      default:
        this.logWarning("Unknown auth type", { type: this.authType });
    }

    // Add custom headers if configured
    if (this.authConfig.customHeaders) {
      Object.assign(headers, this.authConfig.customHeaders);
    }

    return headers;
  }

  /**
   * Health check specific to custom API
   */
  async makeTestRequest() {
    const startTime = Date.now();
    try {
      const testEndpoint = this.endpoints.health || this.endpoints.auth || "/";
      await this.makeApiRequest("GET", testEndpoint);
      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      throw new Error(`Custom API health check failed: ${error.message}`);
    }
  }

  // Mapping and formatting methods

  mapInventoryUpdate(update) {
    const mapping = this.mappings.inventory || {};
    const mapped = {};

    mapped[mapping.quantity || "quantity"] = update.quantity;
    mapped[mapping.sku || "sku"] = update.sku;

    if (update.price && mapping.price) {
      mapped[mapping.price] = update.price;
    }

    // Add any additional fields from mapping
    if (mapping.additionalFields) {
      Object.assign(mapped, mapping.additionalFields);
    }

    return mapped;
  }

  extractOrdersFromResponse(response) {
    const ordersPath = this.mappings.orders?.responsePath || "orders";
    return this.getNestedProperty(response, ordersPath) || [];
  }

  extractEventType(payload) {
    const eventPath = this.mappings.webhooks?.eventTypePath || "type";
    return this.getNestedProperty(payload, eventPath) || "unknown";
  }

  getNestedProperty(obj, path) {
    return path
      .split(".")
      .reduce((current, key) => current && current[key], obj);
  }

  formatOrder(customOrder) {
    const mapping = this.mappings.orders?.fields || {};

    return {
      orderId: this.getNestedProperty(customOrder, mapping.orderId || "id"),
      channelOrderId: this.getNestedProperty(
        customOrder,
        mapping.channelOrderId || "id"
      ),
      customerInfo: {
        id: this.getNestedProperty(
          customOrder,
          mapping.customerId || "customer.id"
        ),
        email: this.getNestedProperty(
          customOrder,
          mapping.customerEmail || "customer.email"
        ),
        name: this.getNestedProperty(
          customOrder,
          mapping.customerName || "customer.name"
        ),
      },
      items: this.formatOrderItems(customOrder, mapping),
      total: parseFloat(
        this.getNestedProperty(customOrder, mapping.total || "total") || 0
      ),
      currency:
        this.getNestedProperty(customOrder, mapping.currency || "currency") ||
        "USD",
      status: this.getNestedProperty(customOrder, mapping.status || "status"),
      createdAt: new Date(
        this.getNestedProperty(customOrder, mapping.createdAt || "created_at")
      ),
      updatedAt: new Date(
        this.getNestedProperty(customOrder, mapping.updatedAt || "updated_at")
      ),
    };
  }

  formatOrderItems(order, mapping) {
    const itemsPath = mapping.items || "items";
    const items = this.getNestedProperty(order, itemsPath) || [];

    return items.map((item) => ({
      productId: this.getNestedProperty(
        item,
        mapping.itemProductId || "product_id"
      ),
      quantity: parseInt(
        this.getNestedProperty(item, mapping.itemQuantity || "quantity") || 1
      ),
      price: parseFloat(
        this.getNestedProperty(item, mapping.itemPrice || "price") || 0
      ),
      sku: this.getNestedProperty(item, mapping.itemSku || "sku"),
      title: this.getNestedProperty(item, mapping.itemTitle || "title"),
    }));
  }

  // Webhook handlers

  async handleOrderCreated(payload) {
    this.logInfo("Order created webhook received");
    return {
      type: "order_created",
      processed: true,
      action: "process_new_order",
    };
  }

  async handleOrderUpdated(payload) {
    this.logInfo("Order updated webhook received");
    return {
      type: "order_updated",
      processed: true,
      action: "update_order_status",
    };
  }

  async handleInventoryUpdated(payload) {
    this.logInfo("Inventory updated webhook received");
    return {
      type: "inventory_updated",
      processed: true,
      action: "sync_inventory_level",
    };
  }

  async handleProductUpdated(payload) {
    this.logInfo("Product updated webhook received");
    return {
      type: "product_updated",
      processed: true,
      action: "sync_product_data",
    };
  }

  // Default configuration methods

  getDefaultEndpoints() {
    return {
      health: "/health",
      inventory: "/products/{id}/inventory",
      inventoryBatch: "/products/inventory/batch",
      inventoryMethod: "PUT",
      orders: "/orders",
      products: "/products",
    };
  }

  getDefaultMappings() {
    return {
      inventory: {
        quantity: "quantity",
        sku: "sku",
        price: "price",
      },
      orders: {
        responsePath: "orders",
        fields: {
          orderId: "id",
          channelOrderId: "id",
          customerId: "customer.id",
          customerEmail: "customer.email",
          customerName: "customer.name",
          items: "items",
          total: "total",
          currency: "currency",
          status: "status",
          createdAt: "created_at",
          updatedAt: "updated_at",
          itemProductId: "product_id",
          itemQuantity: "quantity",
          itemPrice: "price",
          itemSku: "sku",
          itemTitle: "title",
        },
      },
      webhooks: {
        eventTypePath: "type",
      },
    };
  }
}

module.exports = CustomApiConnector;
