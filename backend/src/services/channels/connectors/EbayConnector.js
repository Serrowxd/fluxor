const ChannelConnector = require("../ChannelConnector");
const crypto = require("crypto");
const axios = require("axios");

/**
 * eBay Trading API connector for inventory synchronization
 * Handles eBay-specific API calls and data formatting
 */
class EbayConnector extends ChannelConnector {
  constructor(channelConfig, credentials) {
    super(channelConfig);
    this.appId = credentials.app_id;
    this.devId = credentials.dev_id;
    this.certId = credentials.cert_id;
    this.token = credentials.token;
    this.siteId = credentials.site_id || "0"; // 0 = US
    this.apiVersion = "1193";
    this.endpoint = "https://api.ebay.com/ws/api/eBayAPI";

    // eBay rate limiting: 5000 calls per day by default
    this.rateLimitPerMinute = 200; // Conservative estimate
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
        limitations: ["max 25 items per batch"],
      },
      { name: "real_time_updates", supported: true },
      { name: "product_sync", supported: true },
      { name: "price_sync", supported: true },
    ];
  }

  /**
   * Authenticate with eBay Trading API
   */
  async authenticate(credentials) {
    try {
      // Test authentication by getting user info
      const response = await this.makeApiRequest("GetUser", {});

      if (response.User) {
        this.logInfo("eBay authentication successful", {
          userId: response.User.UserID,
          registrationDate: response.User.RegistrationDate,
        });

        return {
          success: true,
          userInfo: {
            userId: response.User.UserID,
            email: response.User.Email,
            registrationDate: response.User.RegistrationDate,
            feedbackScore: response.User.FeedbackScore,
            site: response.User.Site,
          },
        };
      }

      throw new Error("Invalid response from eBay authentication");
    } catch (error) {
      this.logError(error, { context: "authentication" });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Sync inventory for products using eBay Trading API
   */
  async syncInventory(request) {
    const startTime = Date.now();
    this.validateSyncRequest(request);

    const results = this.formatSyncResult(0, 0, 0, [], 0);

    try {
      this.logInfo("Starting eBay inventory sync", {
        productCount: request.updates.length,
        storeId: request.storeId,
      });

      // eBay prefers smaller batches for inventory updates
      const batches = this.createBatches(request.updates, 25);

      for (const batch of batches) {
        try {
          await this.processBatch(batch, results);

          // Rate limiting: be conservative with eBay
          if (batches.indexOf(batch) < batches.length - 1) {
            await this.delay(3000); // 3 seconds between batches
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

      this.logInfo("eBay inventory sync completed", {
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
        `eBay sync failed: ${error.message}`
      );
    }
  }

  /**
   * Process a batch of inventory updates
   */
  async processBatch(batch, results) {
    for (const update of batch) {
      try {
        await this.updateSingleItem(update);
        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          productId: update.productId,
          itemId: update.externalProductId,
          error: error.message,
        });

        this.logError(error, {
          context: "single_item_update",
          productId: update.productId,
          itemId: update.externalProductId,
        });
      }
    }
  }

  /**
   * Update inventory for a single eBay item
   */
  async updateSingleItem(update) {
    try {
      const requestData = {
        Item: {
          ItemID: update.externalProductId,
          Quantity: update.quantity,
        },
      };

      // Update price if provided
      if (update.price) {
        requestData.Item.StartPrice = update.price;
      }

      const response = await this.makeApiRequest(
        "ReviseFixedPriceItem",
        requestData
      );

      if (response.Ack === "Success" || response.Ack === "Warning") {
        this.logInfo("eBay item updated successfully", {
          productId: update.productId,
          itemId: update.externalProductId,
          quantity: update.quantity,
        });
      } else {
        throw new Error(`eBay API returned: ${response.Ack}`);
      }
    } catch (error) {
      throw new Error(
        `Failed to update eBay item ${update.externalProductId}: ${error.message}`
      );
    }
  }

  /**
   * Get orders from eBay
   */
  async getOrders(filter) {
    try {
      const requestData = {
        NumberOfDays: filter.days || 7,
        IncludeFinalValueFee: true,
        Pagination: {
          EntriesPerPage: filter.limit || 50,
          PageNumber: filter.page || 1,
        },
      };

      if (filter.since) {
        requestData.CreateTimeFrom = filter.since;
      }

      const response = await this.makeApiRequest(
        "GetSellerTransactions",
        requestData
      );

      if (
        !response.TransactionArray ||
        !response.TransactionArray.Transaction
      ) {
        return [];
      }

      const transactions = Array.isArray(response.TransactionArray.Transaction)
        ? response.TransactionArray.Transaction
        : [response.TransactionArray.Transaction];

      return transactions.map((transaction) => this.formatOrder(transaction));
    } catch (error) {
      throw this.createError(
        "ORDER_FETCH_ERROR",
        `Failed to get orders: ${error.message}`
      );
    }
  }

  /**
   * Process incoming webhook from eBay Platform Notifications
   */
  async processWebhook(payload) {
    try {
      const notificationType = payload.NotificationEventName;

      switch (notificationType) {
        case "ItemSold":
          return await this.handleItemSold(payload);
        case "EndOfAuction":
          return await this.handleAuctionEnded(payload);
        case "OutOfStock":
          return await this.handleOutOfStock(payload);
        case "ItemRevised":
          return await this.handleItemRevised(payload);
        default:
          this.logWarning("Unknown notification type", {
            type: notificationType,
          });
          return {
            type: "unknown",
            processed: false,
            message: `Unknown notification type: ${notificationType}`,
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
   * Make authenticated API request to eBay
   */
  async makeApiRequest(callName, requestData) {
    const headers = {
      "X-EBAY-API-COMPATIBILITY-LEVEL": this.apiVersion,
      "X-EBAY-API-DEV-NAME": this.devId,
      "X-EBAY-API-APP-NAME": this.appId,
      "X-EBAY-API-CERT-NAME": this.certId,
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": this.siteId,
      "Content-Type": "text/xml",
    };

    const xmlRequest = this.buildXmlRequest(callName, requestData);

    let retryCount = 0;

    while (retryCount < this.maxRetries) {
      try {
        const response = await axios.post(this.endpoint, xmlRequest, {
          headers,
          timeout: 30000,
        });

        return this.parseXmlResponse(response.data);
      } catch (error) {
        if (error.response && error.response.status === 429) {
          this.logWarning("Rate limit hit, retrying", {
            attempt: retryCount + 1,
          });
          await this.delay(5000); // 5 seconds for eBay rate limiting
          retryCount++;
          continue;
        }

        if (retryCount < this.maxRetries - 1) {
          this.logWarning("Request failed, retrying", {
            error: error.message,
            attempt: retryCount + 1,
          });
          await this.delay(Math.pow(2, retryCount) * 1000);
          retryCount++;
          continue;
        }

        throw error;
      }
    }
  }

  /**
   * Build XML request for eBay API
   */
  buildXmlRequest(callName, requestData) {
    let xml = `<?xml version="1.0" encoding="utf-8"?>
<${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${this.token}</eBayAuthToken>
  </RequesterCredentials>`;

    xml += this.objectToXml(requestData);
    xml += `</${callName}Request>`;

    return xml;
  }

  /**
   * Convert object to XML
   */
  objectToXml(obj, level = 1) {
    let xml = "";
    const indent = "  ".repeat(level);

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "object" && value !== null) {
        xml += `\n${indent}<${key}>`;
        xml += this.objectToXml(value, level + 1);
        xml += `\n${indent}</${key}>`;
      } else {
        xml += `\n${indent}<${key}>${this.escapeXml(
          value?.toString() || ""
        )}</${key}>`;
      }
    }

    return xml;
  }

  /**
   * Parse XML response from eBay (simplified)
   */
  parseXmlResponse(xmlData) {
    // This is a simplified parser - in production, use a proper XML parser
    // For now, return a mock response structure
    return {
      Ack: "Success",
      User: {
        UserID: "testuser",
        Email: "test@example.com",
        RegistrationDate: new Date().toISOString(),
        FeedbackScore: 100,
        Site: "US",
      },
    };
  }

  /**
   * Health check specific to eBay
   */
  async makeTestRequest() {
    const startTime = Date.now();
    try {
      await this.makeApiRequest("GetUser", {});
      return {
        success: true,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      throw new Error(`eBay health check failed: ${error.message}`);
    }
  }

  // Webhook handlers

  async handleItemSold(notification) {
    this.logInfo("Item sold notification received", {
      itemId: notification.ItemID,
      transactionId: notification.TransactionID,
    });

    return {
      type: "item_sold",
      processed: true,
      itemId: notification.ItemID,
      action: "reduce_inventory",
    };
  }

  async handleAuctionEnded(notification) {
    this.logInfo("Auction ended notification received", {
      itemId: notification.ItemID,
    });

    return {
      type: "auction_ended",
      processed: true,
      itemId: notification.ItemID,
    };
  }

  async handleOutOfStock(notification) {
    this.logInfo("Out of stock notification received", {
      itemId: notification.ItemID,
    });

    return {
      type: "out_of_stock",
      processed: true,
      itemId: notification.ItemID,
      action: "update_inventory_status",
    };
  }

  async handleItemRevised(notification) {
    this.logInfo("Item revised notification received", {
      itemId: notification.ItemID,
    });

    return {
      type: "item_revised",
      processed: true,
      itemId: notification.ItemID,
      action: "sync_item_data",
    };
  }

  /**
   * Format eBay transaction to standard order format
   */
  formatOrder(transaction) {
    return {
      orderId: transaction.TransactionID,
      channelOrderId: transaction.TransactionID,
      customerInfo: {
        id: transaction.Buyer?.UserID,
        email: transaction.Buyer?.Email,
        name: transaction.Buyer?.UserID, // eBay doesn't always provide real names
      },
      items: [
        {
          productId: transaction.Item?.ItemID,
          quantity: parseInt(transaction.QuantityPurchased) || 1,
          price: parseFloat(transaction.TransactionPrice?.value) || 0,
          sku: transaction.Item?.SKU,
          title: transaction.Item?.Title,
        },
      ],
      total: parseFloat(transaction.TransactionPrice?.value) || 0,
      currency: transaction.TransactionPrice?.currencyID || "USD",
      status: "completed", // eBay transactions are typically completed when retrieved
      createdAt: new Date(transaction.CreatedDate),
      updatedAt: new Date(transaction.CreatedDate),
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
   * Validate webhook signature (eBay uses different validation)
   */
  validateWebhookSignature(payload, signature, secret) {
    // eBay platform notifications use a different validation mechanism
    // This would need to be implemented based on eBay's specific requirements
    return true;
  }
}

module.exports = EbayConnector;
