const ChannelConnector = require("../ChannelConnector");
const crypto = require("crypto");
const axios = require("axios");

/**
 * Square POS API connector for inventory synchronization
 * Handles Square-specific API calls and data formatting
 */
class SquareConnector extends ChannelConnector {
  constructor(channelConfig, credentials) {
    super(channelConfig);
    this.applicationId = credentials.application_id;
    this.accessToken = credentials.access_token;
    this.locationId = credentials.location_id;
    this.environment = credentials.environment || "production";

    this.endpoint =
      this.environment === "production"
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com";

    // Square rate limiting: 1000 requests per minute per application
    this.rateLimitPerMinute = 1000;
    this.maxRetries = 3;
  }

  getCapabilities() {
    return [
      { name: "inventory_sync", supported: true },
      { name: "order_sync", supported: true },
      { name: "webhook_support", supported: true },
      {
        name: "bulk_operations",
        supported: true,
        limitations: ["max 1000 items per batch"],
      },
      { name: "real_time_updates", supported: true },
      { name: "product_sync", supported: true },
      { name: "price_sync", supported: true },
    ];
  }

  /**
   * Authenticate with Square API
   */
  async authenticate(credentials) {
    try {
      // Test authentication by getting location info
      const response = await this.makeApiRequest(
        "GET",
        `/v2/locations/${this.locationId}`
      );

      if (response.location) {
        this.logInfo("Square authentication successful", {
          locationId: response.location.id,
          locationName: response.location.name,
          merchantId: response.location.merchant_id,
        });

        return {
          success: true,
          locationInfo: {
            id: response.location.id,
            name: response.location.name,
            merchantId: response.location.merchant_id,
            status: response.location.status,
            currency: response.location.currency,
            country: response.location.country,
            businessName: response.location.business_name,
          },
        };
      }

      throw new Error("Invalid response from Square authentication");
    } catch (error) {
      this.logError(error, { context: "authentication" });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Sync inventory for products using Square API
   */
  async syncInventory(request) {
    const startTime = Date.now();
    this.validateSyncRequest(request);

    const results = this.formatSyncResult(0, 0, 0, [], 0);

    try {
      this.logInfo("Starting Square inventory sync", {
        productCount: request.updates.length,
        storeId: request.storeId,
      });

      // Square allows larger batches for inventory updates
      const batches = this.createBatches(request.updates, 100);

      for (const batch of batches) {
        try {
          await this.processBatch(batch, results);

          // Rate limiting: Square is more generous
          if (batches.indexOf(batch) < batches.length - 1) {
            await this.delay(500); // 0.5 seconds between batches
          }
        } catch (error) {
          this.logError(error, {
            context: "batch_processing",
            batchSize: batch.length,
          });

          // Handle individual items in failed batch
          for (const item of batch) {
            results.failed++;
            results.errors.push({
              productId: item.productId,
              sku: item.sku,
              error: error.message,
            });
          }
        }

        results.totalProcessed += batch.length;
      }

      results.duration = Date.now() - startTime;

      this.logInfo("Square inventory sync completed", {
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
        `Square sync failed: ${error.message}`
      );
    }
  }

  /**
   * Process a batch of inventory updates
   */
  async processBatch(batch, results) {
    // Square prefers batch updates using the BatchChangeInventory endpoint
    try {
      const changes = batch.map((update) => ({
        type: "PHYSICAL_COUNT",
        physical_count: {
          catalog_object_id: update.externalProductId,
          location_id: this.locationId,
          quantity: update.quantity.toString(),
          occurred_at: new Date().toISOString(),
        },
      }));

      const requestData = {
        idempotency_key: this.generateIdempotencyKey(),
        changes: changes,
      };

      const response = await this.makeApiRequest(
        "POST",
        "/v2/inventory/batch-change",
        requestData
      );

      if (response.counts && response.counts.length > 0) {
        results.successful += batch.length;
        this.logInfo("Batch processed successfully", {
          batchSize: batch.length,
          countsUpdated: response.counts.length,
        });
      } else {
        results.failed += batch.length;
        results.errors.push({
          batch: batch.map((item) => item.sku),
          error: "No inventory counts returned from Square",
        });
      }
    } catch (error) {
      results.failed += batch.length;
      results.errors.push({
        batch: batch.map((item) => item.sku),
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get orders from Square
   */
  async getOrders(filter) {
    try {
      const query = {
        location_ids: [this.locationId],
      };

      if (filter.since) {
        query.created_at = {
          start_at: filter.since,
        };
      }

      if (filter.status) {
        query.state_filter = {
          states: [filter.status.toUpperCase()],
        };
      }

      const requestData = {
        query: query,
        limit: filter.limit || 50,
      };

      const response = await this.makeApiRequest(
        "POST",
        "/v2/orders/search",
        requestData
      );

      if (!response.orders) {
        return [];
      }

      return response.orders.map((order) => this.formatOrder(order));
    } catch (error) {
      throw this.createError(
        "ORDER_FETCH_ERROR",
        `Failed to get orders: ${error.message}`
      );
    }
  }

  /**
   * Process incoming webhook from Square
   */
  async processWebhook(payload) {
    try {
      const eventType = payload.type;

      switch (eventType) {
        case "order.created":
          return await this.handleOrderCreated(payload.data.object.order);
        case "order.updated":
          return await this.handleOrderUpdated(payload.data.object.order);
        case "inventory.count.updated":
          return await this.handleInventoryCountUpdated(
            payload.data.object.inventory_count
          );
        case "catalog.version.updated":
          return await this.handleCatalogUpdated(payload.data.object.catalog);
        default:
          this.logWarning("Unknown webhook type", { type: eventType });
          return {
            type: "unknown",
            processed: false,
            message: `Unknown webhook type: ${eventType}`,
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
   * Validate webhook signature for Square
   */
  validateWebhookSignature(payload, signature, secret) {
    try {
      // Square uses HMAC-SHA1 for webhook signatures
      const body =
        typeof payload === "string" ? payload : JSON.stringify(payload);
      const hmac = crypto.createHmac("sha1", secret);
      hmac.update(body);
      const computedSignature = hmac.digest("base64");

      return signature === computedSignature;
    } catch (error) {
      this.logError(error, { context: "webhook_signature_validation" });
      return false;
    }
  }

  /**
   * Make authenticated API request to Square
   */
  async makeApiRequest(method, endpoint, data = null) {
    const url = `${this.endpoint}${endpoint}`;
    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": "2023-10-18",
    };

    const config = {
      method,
      url,
      headers,
      timeout: 30000,
    };

    if (data && (method === "POST" || method === "PUT")) {
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
              error.response.data?.errors?.[0]?.detail || error.message;
            throw new Error(`Square API error (${status}): ${errorMessage}`);
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
   * Health check specific to Square
   */
  async makeTestRequest() {
    const startTime = Date.now();
    try {
      await this.makeApiRequest("GET", `/v2/locations/${this.locationId}`);
      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      throw new Error(`Square health check failed: ${error.message}`);
    }
  }

  // Webhook handlers

  async handleOrderCreated(order) {
    this.logInfo("Order created webhook received", { orderId: order.id });

    return {
      type: "order_created",
      processed: true,
      orderId: order.id,
      action: "process_new_order",
    };
  }

  async handleOrderUpdated(order) {
    this.logInfo("Order updated webhook received", { orderId: order.id });

    return {
      type: "order_updated",
      processed: true,
      orderId: order.id,
      action: "update_order_status",
    };
  }

  async handleInventoryCountUpdated(inventoryCount) {
    this.logInfo("Inventory count updated webhook received", {
      catalogObjectId: inventoryCount.catalog_object_id,
      quantity: inventoryCount.quantity,
    });

    return {
      type: "inventory_update",
      processed: true,
      catalogObjectId: inventoryCount.catalog_object_id,
      newQuantity: inventoryCount.quantity,
      action: "sync_inventory_count",
    };
  }

  async handleCatalogUpdated(catalog) {
    this.logInfo("Catalog updated webhook received", {
      version: catalog.version,
    });

    return {
      type: "catalog_updated",
      processed: true,
      version: catalog.version,
      action: "sync_catalog_changes",
    };
  }

  /**
   * Format Square order to standard format
   */
  formatOrder(squareOrder) {
    const lineItems = squareOrder.line_items || [];

    return {
      orderId: squareOrder.id,
      channelOrderId: squareOrder.id,
      customerInfo: {
        id: squareOrder.customer_id || null,
        email: null, // Square doesn't always include customer email in order data
        name: null,
      },
      items: lineItems.map((item) => ({
        productId: item.catalog_object_id,
        quantity: parseInt(item.quantity) || 1,
        price: parseFloat(item.base_price_money?.amount || 0) / 100, // Square uses cents
        sku: item.variation_name,
        title: item.name,
      })),
      total: parseFloat(squareOrder.total_money?.amount || 0) / 100, // Square uses cents
      currency: squareOrder.total_money?.currency || "USD",
      status: squareOrder.state || "open",
      locationId: squareOrder.location_id,
      createdAt: new Date(squareOrder.created_at),
      updatedAt: new Date(squareOrder.updated_at),
    };
  }

  /**
   * Generate idempotency key for Square API calls
   */
  generateIdempotencyKey() {
    return crypto.randomUUID();
  }
}

module.exports = SquareConnector;
