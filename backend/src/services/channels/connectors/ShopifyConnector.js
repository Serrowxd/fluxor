const ChannelConnector = require("../ChannelConnector");
const crypto = require("crypto");
const axios = require("axios");

/**
 * Shopify channel connector for inventory synchronization
 * Handles Shopify-specific API calls, webhooks, and data formatting
 */
class ShopifyConnector extends ChannelConnector {
  constructor(channelConfig, credentials) {
    super(channelConfig);
    this.shopDomain = credentials.shop_domain;
    this.accessToken = credentials.access_token;
    this.apiVersion = credentials.api_version || "2023-10";
    this.apiBaseUrl = `https://${this.shopDomain}/admin/api/${this.apiVersion}`;

    // Shopify rate limiting: 40 requests per app per store per minute
    this.rateLimitPerMinute = 40;
    this.rateLimitPerSecond = 2;
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
        limitations: ["max 250 items per batch"],
      },
      { name: "real_time_updates", supported: true },
      { name: "product_sync", supported: true },
      { name: "price_sync", supported: true },
    ];
  }

  /**
   * Authenticate with Shopify using access token
   */
  async authenticate(credentials) {
    try {
      const response = await this.makeApiRequest("GET", "/shop.json");

      if (response.shop) {
        this.logInfo("Shopify authentication successful", {
          shopId: response.shop.id,
          shopName: response.shop.name,
          domain: response.shop.domain,
        });

        return {
          success: true,
          shopInfo: {
            id: response.shop.id,
            name: response.shop.name,
            domain: response.shop.domain,
            email: response.shop.email,
            currency: response.shop.currency,
            timezone: response.shop.timezone,
          },
        };
      }

      throw new Error("Invalid response from Shopify authentication");
    } catch (error) {
      this.logError(error, { context: "authentication" });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Sync inventory for products
   */
  async syncInventory(request) {
    const startTime = Date.now();
    this.validateSyncRequest(request);

    const results = this.formatSyncResult(0, 0, 0, [], 0);

    try {
      this.logInfo("Starting Shopify inventory sync", {
        productCount: request.updates.length,
        storeId: request.storeId,
      });

      // Process in batches to respect rate limits
      const batches = this.createBatches(request.updates, 50);

      for (const batch of batches) {
        try {
          await this.processBatch(batch, results);

          // Rate limiting: wait between batches
          if (batches.indexOf(batch) < batches.length - 1) {
            await this.delay(1000); // 1 second between batches
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
              error: error.message,
            });
          }
        }

        results.totalProcessed += batch.length;
      }

      results.duration = Date.now() - startTime;

      this.logInfo("Shopify inventory sync completed", {
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
        `Shopify sync failed: ${error.message}`
      );
    }
  }

  /**
   * Process a batch of inventory updates
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
          externalProductId: update.externalProductId,
          error: error.message,
        });

        this.logError(error, {
          context: "single_product_update",
          productId: update.productId,
          externalProductId: update.externalProductId,
        });
      }
    }
  }

  /**
   * Update inventory for a single product
   */
  async updateSingleProduct(update) {
    try {
      // Get the product's inventory item ID
      const product = await this.getProduct(update.externalProductId);

      if (!product || !product.variants || product.variants.length === 0) {
        throw new Error(
          `Product not found or has no variants: ${update.externalProductId}`
        );
      }

      // Update inventory for each variant
      for (const variant of product.variants) {
        if (variant.inventory_item_id) {
          await this.updateInventoryLevel(
            variant.inventory_item_id,
            update.quantity
          );
        }

        // Update price if provided
        if (update.price && update.price !== variant.price) {
          await this.updateVariantPrice(variant.id, update.price);
        }
      }

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
   * Get product details from Shopify
   */
  async getProduct(productId) {
    try {
      const response = await this.makeApiRequest(
        "GET",
        `/products/${productId}.json`
      );
      return response.product;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Update inventory level for a specific inventory item
   */
  async updateInventoryLevel(inventoryItemId, quantity) {
    try {
      // First, get the current inventory level to find the location
      const inventoryLevels = await this.makeApiRequest(
        "GET",
        `/inventory_levels.json?inventory_item_ids=${inventoryItemId}`
      );

      if (
        !inventoryLevels.inventory_levels ||
        inventoryLevels.inventory_levels.length === 0
      ) {
        throw new Error(
          `No inventory levels found for item ${inventoryItemId}`
        );
      }

      // Update inventory at the primary location
      const primaryLevel = inventoryLevels.inventory_levels[0];
      const locationId = primaryLevel.location_id;

      await this.makeApiRequest("POST", "/inventory_levels/set.json", {
        inventory_item_id: inventoryItemId,
        location_id: locationId,
        available: quantity,
      });
    } catch (error) {
      throw new Error(`Failed to update inventory level: ${error.message}`);
    }
  }

  /**
   * Update variant price
   */
  async updateVariantPrice(variantId, price) {
    try {
      await this.makeApiRequest("PUT", `/variants/${variantId}.json`, {
        variant: {
          id: variantId,
          price: price.toString(),
        },
      });
    } catch (error) {
      throw new Error(`Failed to update variant price: ${error.message}`);
    }
  }

  /**
   * Get orders from Shopify
   */
  async getOrders(filter) {
    try {
      const params = new URLSearchParams();

      if (filter.since) {
        params.append("created_at_min", filter.since);
      }

      if (filter.status) {
        params.append("status", filter.status);
      }

      params.append("limit", filter.limit || 50);

      const response = await this.makeApiRequest(
        "GET",
        `/orders.json?${params.toString()}`
      );

      return response.orders.map((order) => this.formatOrder(order));
    } catch (error) {
      throw this.createError(
        "ORDER_FETCH_ERROR",
        `Failed to get orders: ${error.message}`
      );
    }
  }

  /**
   * Process incoming webhook
   */
  async processWebhook(payload) {
    try {
      const webhookType = this.determineWebhookType(payload);

      switch (webhookType) {
        case "orders/create":
          return await this.handleOrderCreated(payload);
        case "orders/updated":
          return await this.handleOrderUpdated(payload);
        case "orders/paid":
          return await this.handleOrderPaid(payload);
        case "inventory_levels/update":
          return await this.handleInventoryLevelUpdate(payload);
        case "products/update":
          return await this.handleProductUpdated(payload);
        default:
          this.logWarning("Unknown webhook type", { type: webhookType });
          return {
            type: "unknown",
            processed: false,
            message: `Unknown webhook type: ${webhookType}`,
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
   * Validate webhook signature
   */
  validateWebhookSignature(payload, signature, secret) {
    try {
      const hmac = crypto.createHmac("sha256", secret);
      hmac.update(JSON.stringify(payload));
      const computedSignature = hmac.digest("base64");

      return signature === computedSignature;
    } catch (error) {
      this.logError(error, { context: "webhook_signature_validation" });
      return false;
    }
  }

  /**
   * Make authenticated API request to Shopify
   */
  async makeApiRequest(method, endpoint, data = null) {
    const url = `${this.apiBaseUrl}${endpoint}`;
    const headers = {
      "X-Shopify-Access-Token": this.accessToken,
      "Content-Type": "application/json",
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
              error.response.data?.errors ||
              error.response.data?.error ||
              error.message;
            throw new Error(`Shopify API error (${status}): ${errorMessage}`);
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
   * Health check specific to Shopify
   */
  async makeTestRequest() {
    const startTime = Date.now();
    try {
      await this.makeApiRequest("GET", "/shop.json");
      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      throw new Error(`Shopify health check failed: ${error.message}`);
    }
  }

  // Webhook handlers

  async handleOrderCreated(order) {
    this.logInfo("Order created webhook received", { orderId: order.id });

    return {
      type: "order_created",
      processed: true,
      orderId: order.id,
      action: "reserve_inventory",
    };
  }

  async handleOrderUpdated(order) {
    this.logInfo("Order updated webhook received", { orderId: order.id });

    return {
      type: "order_updated",
      processed: true,
      orderId: order.id,
    };
  }

  async handleOrderPaid(order) {
    this.logInfo("Order paid webhook received", { orderId: order.id });

    return {
      type: "order_paid",
      processed: true,
      orderId: order.id,
      action: "confirm_inventory_reduction",
    };
  }

  async handleInventoryLevelUpdate(inventoryLevel) {
    this.logInfo("Inventory level update webhook received", {
      inventoryItemId: inventoryLevel.inventory_item_id,
      available: inventoryLevel.available,
    });

    return {
      type: "inventory_update",
      processed: true,
      inventoryItemId: inventoryLevel.inventory_item_id,
      newLevel: inventoryLevel.available,
      action: "sync_inventory_level",
    };
  }

  async handleProductUpdated(product) {
    this.logInfo("Product updated webhook received", { productId: product.id });

    return {
      type: "product_updated",
      processed: true,
      productId: product.id,
      action: "sync_product_data",
    };
  }

  // Helper methods

  determineWebhookType(payload) {
    // Shopify doesn't include the webhook type in the payload
    // This would typically be determined by the webhook endpoint or headers
    if (payload.id && payload.line_items) {
      if (payload.financial_status === "paid") {
        return "orders/paid";
      }
      return payload.created_at === payload.updated_at
        ? "orders/create"
        : "orders/updated";
    }

    if (payload.inventory_item_id && payload.available !== undefined) {
      return "inventory_levels/update";
    }

    if (payload.id && payload.variants) {
      return "products/update";
    }

    return "unknown";
  }

  formatOrder(shopifyOrder) {
    return {
      orderId: shopifyOrder.id.toString(),
      channelOrderId: shopifyOrder.order_number.toString(),
      customerInfo: {
        id: shopifyOrder.customer?.id,
        email: shopifyOrder.customer?.email,
        name: `${shopifyOrder.customer?.first_name || ""} ${
          shopifyOrder.customer?.last_name || ""
        }`.trim(),
      },
      items: shopifyOrder.line_items.map((item) => ({
        productId: item.product_id.toString(),
        variantId: item.variant_id?.toString(),
        quantity: item.quantity,
        price: parseFloat(item.price),
        sku: item.sku,
        title: item.title,
      })),
      total: parseFloat(shopifyOrder.total_price),
      currency: shopifyOrder.currency,
      status: shopifyOrder.fulfillment_status || "unfulfilled",
      financialStatus: shopifyOrder.financial_status,
      createdAt: new Date(shopifyOrder.created_at),
      updatedAt: new Date(shopifyOrder.updated_at),
    };
  }
}

module.exports = ShopifyConnector;
