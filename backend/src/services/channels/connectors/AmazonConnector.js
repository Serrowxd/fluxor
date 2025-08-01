const ChannelConnector = require("../ChannelConnector");
const crypto = require("crypto");
const axios = require("axios");

/**
 * Amazon Seller Central API connector for inventory synchronization
 * Handles Amazon MWS/SP-API calls and data formatting
 */
class AmazonConnector extends ChannelConnector {
  constructor(channelConfig, credentials) {
    super(channelConfig);
    this.merchantId = credentials.merchant_id;
    this.marketplaceId = credentials.marketplace_id;
    this.accessKeyId = credentials.access_key_id;
    this.secretAccessKey = credentials.secret_access_key;
    this.region = credentials.region || "us-east-1";
    this.endpoint = `https://sellingpartnerapi-na.amazon.com`;

    // Amazon rate limiting: varies by operation
    this.rateLimitPerMinute = 200;
    this.maxRetries = 3;
  }

  getCapabilities() {
    return [
      { name: "inventory_sync", supported: true },
      { name: "order_sync", supported: true },
      { name: "webhook_support", supported: false }, // Amazon doesn't support webhooks in the same way
      {
        name: "bulk_operations",
        supported: true,
        limitations: ["max 1000 items per batch"],
      },
      { name: "real_time_updates", supported: false },
      { name: "product_sync", supported: true },
      { name: "price_sync", supported: true },
    ];
  }

  /**
   * Authenticate with Amazon SP-API
   */
  async authenticate(credentials) {
    try {
      // Test authentication by making a simple API call
      const response = await this.makeApiRequest(
        "GET",
        "/sellers/v1/marketplaceParticipations"
      );

      if (response && response.payload) {
        this.logInfo("Amazon authentication successful", {
          marketplaces: response.payload.length,
          merchantId: this.merchantId,
        });

        return {
          success: true,
          marketplaces: response.payload.map((mp) => ({
            marketplaceId: mp.marketplace.id,
            name: mp.marketplace.name,
            defaultCurrency: mp.marketplace.defaultCurrencyCode,
            defaultLanguage: mp.marketplace.defaultLanguageCode,
          })),
        };
      }

      throw new Error("Invalid response from Amazon authentication");
    } catch (error) {
      this.logError(error, { context: "authentication" });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Sync inventory for products using Amazon SP-API
   */
  async syncInventory(request) {
    const startTime = Date.now();
    this.validateSyncRequest(request);

    const results = this.formatSyncResult(0, 0, 0, [], 0);

    try {
      this.logInfo("Starting Amazon inventory sync", {
        productCount: request.updates.length,
        storeId: request.storeId,
      });

      // Amazon prefers smaller batches for inventory updates
      const batches = this.createBatches(request.updates, 100);

      for (const batch of batches) {
        try {
          await this.processBatch(batch, results);

          // Rate limiting: Amazon has complex rate limits, be conservative
          if (batches.indexOf(batch) < batches.length - 1) {
            await this.delay(2000); // 2 seconds between batches
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

      this.logInfo("Amazon inventory sync completed", {
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
        `Amazon sync failed: ${error.message}`
      );
    }
  }

  /**
   * Process a batch of inventory updates
   */
  async processBatch(batch, results) {
    try {
      // Prepare inventory update feed
      const inventoryFeed = this.createInventoryFeed(batch);

      // Submit feed to Amazon
      const feedResult = await this.submitFeed(
        "POST_INVENTORY_AVAILABILITY_DATA",
        inventoryFeed
      );

      if (feedResult.success) {
        results.successful += batch.length;
        this.logInfo("Batch processed successfully", {
          batchSize: batch.length,
          feedId: feedResult.feedId,
        });
      } else {
        results.failed += batch.length;
        results.errors.push({
          batch: batch.map((item) => item.sku),
          error: feedResult.error,
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
   * Create inventory feed XML for Amazon
   */
  createInventoryFeed(updates) {
    const timestamp = new Date().toISOString();

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="amzn-envelope.xsd">
  <Header>
    <DocumentVersion>1.01</DocumentVersion>
    <MerchantIdentifier>${this.merchantId}</MerchantIdentifier>
  </Header>
  <MessageType>Inventory</MessageType>
  <PurgeAndReplace>false</PurgeAndReplace>`;

    updates.forEach((update, index) => {
      xml += `
  <Message>
    <MessageID>${index + 1}</MessageID>
    <OperationType>Update</OperationType>
    <Inventory>
      <SKU>${this.escapeXml(update.sku)}</SKU>
      <Quantity>${update.quantity}</Quantity>
    </Inventory>
  </Message>`;
    });

    xml += `
</AmazonEnvelope>`;

    return xml;
  }

  /**
   * Submit feed to Amazon SP-API
   */
  async submitFeed(feedType, feedContent) {
    try {
      // Step 1: Create feed document
      const createFeedDocResponse = await this.makeApiRequest(
        "POST",
        "/feeds/2021-06-30/documents",
        {
          contentType: "text/xml; charset=UTF-8",
        }
      );

      if (!createFeedDocResponse.url) {
        throw new Error("Failed to create feed document");
      }

      // Step 2: Upload feed content
      await this.uploadFeedContent(createFeedDocResponse.url, feedContent);

      // Step 3: Create feed
      const createFeedResponse = await this.makeApiRequest(
        "POST",
        "/feeds/2021-06-30/feeds",
        {
          feedType: feedType,
          marketplaceIds: [this.marketplaceId],
          inputFeedDocumentId: createFeedDocResponse.feedDocumentId,
        }
      );

      if (!createFeedResponse.feedId) {
        throw new Error("Failed to create feed");
      }

      this.logInfo("Feed submitted successfully", {
        feedId: createFeedResponse.feedId,
        feedType,
      });

      return {
        success: true,
        feedId: createFeedResponse.feedId,
      };
    } catch (error) {
      this.logError(error, { context: "submit_feed", feedType });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Upload feed content to Amazon's pre-signed URL
   */
  async uploadFeedContent(url, content) {
    try {
      await axios.put(url, content, {
        headers: {
          "Content-Type": "text/xml; charset=UTF-8",
        },
        timeout: 60000,
      });
    } catch (error) {
      throw new Error(`Failed to upload feed content: ${error.message}`);
    }
  }

  /**
   * Get orders from Amazon
   */
  async getOrders(filter) {
    try {
      const params = new URLSearchParams();
      params.append("MarketplaceIds", this.marketplaceId);

      if (filter.since) {
        params.append("CreatedAfter", filter.since);
      } else {
        // Default to last 7 days
        const weekAgo = new Date(
          Date.now() - 7 * 24 * 60 * 60 * 1000
        ).toISOString();
        params.append("CreatedAfter", weekAgo);
      }

      if (filter.status) {
        params.append("OrderStatuses", filter.status.toUpperCase());
      }

      const response = await this.makeApiRequest(
        "GET",
        `/orders/v0/orders?${params.toString()}`
      );

      if (!response.payload || !response.payload.Orders) {
        return [];
      }

      return response.payload.Orders.map((order) => this.formatOrder(order));
    } catch (error) {
      throw this.createError(
        "ORDER_FETCH_ERROR",
        `Failed to get orders: ${error.message}`
      );
    }
  }

  /**
   * Process incoming notification (Amazon doesn't have traditional webhooks)
   */
  async processWebhook(payload) {
    // Amazon uses SQS notifications rather than webhooks
    // This would handle SQS messages or direct API polling results
    try {
      this.logInfo("Processing Amazon notification", { payload });

      return {
        type: "notification",
        processed: true,
        message: "Amazon notification processed",
      };
    } catch (error) {
      this.logError(error, { context: "webhook_processing" });
      throw this.createError(
        "WEBHOOK_ERROR",
        `Failed to process notification: ${error.message}`
      );
    }
  }

  /**
   * Make authenticated API request to Amazon SP-API
   */
  async makeApiRequest(method, endpoint, data = null) {
    const url = `${this.endpoint}${endpoint}`;

    // Amazon requires AWS Signature Version 4
    const headers = await this.createAwsHeaders(method, endpoint, data);

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
            const retryAfter = error.response.headers["retry-after"] || 5;
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
              error.response.data?.errors?.[0]?.message || error.message;
            throw new Error(`Amazon API error (${status}): ${errorMessage}`);
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
   * Create AWS Signature Version 4 headers for Amazon SP-API
   */
  async createAwsHeaders(method, endpoint, data) {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = timestamp.substr(0, 8);

    const service = "execute-api";
    const host = this.endpoint.replace("https://", "");

    // Create canonical request
    const canonicalHeaders = `host:${host}\nx-amz-date:${timestamp}\n`;
    const signedHeaders = "host;x-amz-date";
    const payloadHash = this.hash(data ? JSON.stringify(data) : "");

    const canonicalRequest = [
      method,
      endpoint,
      "", // query string
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    // Create string to sign
    const credentialScope = `${date}/${this.region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      timestamp,
      credentialScope,
      this.hash(canonicalRequest),
    ].join("\n");

    // Calculate signature
    const signature = this.calculateSignature(date, stringToSign);

    // Create authorization header
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      Host: host,
      "X-Amz-Date": timestamp,
      Authorization: authorization,
      "Content-Type": "application/json",
      "x-amz-access-token": "your-lwa-access-token", // This would be obtained through LWA
    };
  }

  /**
   * Calculate AWS Signature Version 4 signature
   */
  calculateSignature(date, stringToSign) {
    const kDate = this.hmac(`AWS4${this.secretAccessKey}`, date);
    const kRegion = this.hmac(kDate, this.region);
    const kService = this.hmac(kRegion, "execute-api");
    const kSigning = this.hmac(kService, "aws4_request");

    return this.hmac(kSigning, stringToSign, "hex");
  }

  /**
   * HMAC helper function
   */
  hmac(key, data, encoding = null) {
    const hmac = crypto.createHmac("sha256", key);
    hmac.update(data);
    return encoding ? hmac.digest(encoding) : hmac.digest();
  }

  /**
   * SHA256 hash helper function
   */
  hash(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Health check specific to Amazon
   */
  async makeTestRequest() {
    const startTime = Date.now();
    try {
      await this.makeApiRequest("GET", "/sellers/v1/marketplaceParticipations");
      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      throw new Error(`Amazon health check failed: ${error.message}`);
    }
  }

  /**
   * Format Amazon order to standard format
   */
  formatOrder(amazonOrder) {
    return {
      orderId: amazonOrder.AmazonOrderId,
      channelOrderId: amazonOrder.AmazonOrderId,
      customerInfo: {
        id: amazonOrder.BuyerEmail ? "masked" : null, // Amazon masks customer info
        email: amazonOrder.BuyerEmail || null,
        name: amazonOrder.BuyerName || "Amazon Customer",
      },
      items: [], // Would need separate API call to get order items
      total: parseFloat(amazonOrder.OrderTotal?.Amount || 0),
      currency: amazonOrder.OrderTotal?.CurrencyCode || "USD",
      status: amazonOrder.OrderStatus,
      fulfillmentChannel: amazonOrder.FulfillmentChannel,
      createdAt: new Date(amazonOrder.PurchaseDate),
      updatedAt: new Date(amazonOrder.LastUpdateDate),
    };
  }

  /**
   * XML escape helper
   */
  escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, function (c) {
      switch (c) {
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case "&":
          return "&amp;";
        case "'":
          return "&apos;";
        case '"':
          return "&quot;";
      }
    });
  }

  /**
   * Amazon doesn't use traditional webhook signatures
   */
  validateWebhookSignature(payload, signature, secret) {
    // For SQS notifications, validation would be different
    return true;
  }
}

module.exports = AmazonConnector;
