const ChannelConnector = require("./ChannelConnector");
const ShopifyConnector = require("./connectors/ShopifyConnector");
const AmazonConnector = require("./connectors/AmazonConnector");
const EbayConnector = require("./connectors/EbayConnector");
const SquareConnector = require("./connectors/SquareConnector");
const CustomApiConnector = require("./connectors/CustomApiConnector");

/**
 * Factory class for creating channel connector instances
 * Manages instantiation and configuration of different channel types
 */
class ChannelFactory {
  constructor() {
    this.connectorClasses = new Map([
      ["shopify", ShopifyConnector],
      ["amazon", AmazonConnector],
      ["ebay", EbayConnector],
      ["square", SquareConnector],
      ["custom", CustomApiConnector],
    ]);

    this.activeConnectors = new Map();
  }

  /**
   * Create a new channel connector instance
   * @param {Object} channelConfig - Channel configuration from database
   * @param {Object} credentials - Decrypted credentials for the channel
   * @returns {ChannelConnector} - Configured channel connector instance
   */
  async createConnector(channelConfig, credentials) {
    try {
      const ConnectorClass = this.connectorClasses.get(
        channelConfig.channel_type
      );

      if (!ConnectorClass) {
        throw new Error(
          `Unsupported channel type: ${channelConfig.channel_type}`
        );
      }

      // Validate that the connector extends ChannelConnector
      if (!ConnectorClass.prototype instanceof ChannelConnector) {
        throw new Error(
          `Invalid connector class for type: ${channelConfig.channel_type}`
        );
      }

      const connector = new ConnectorClass(channelConfig, credentials);

      // Test authentication
      const authResult = await connector.authenticate(credentials);
      if (!authResult.success) {
        throw new Error(`Authentication failed: ${authResult.error}`);
      }

      // Cache the active connector
      const cacheKey = `${channelConfig.store_id}-${channelConfig.channel_id}`;
      this.activeConnectors.set(cacheKey, {
        connector,
        createdAt: new Date(),
        lastUsed: new Date(),
      });

      return connector;
    } catch (error) {
      throw new Error(`Failed to create connector: ${error.message}`);
    }
  }

  /**
   * Get an existing connector from cache or create a new one
   * @param {string} storeId - Store ID
   * @param {string} channelId - Channel ID
   * @param {Object} channelConfig - Channel configuration
   * @param {Object} credentials - Channel credentials
   * @returns {ChannelConnector} - Channel connector instance
   */
  async getConnector(storeId, channelId, channelConfig, credentials) {
    const cacheKey = `${storeId}-${channelId}`;
    const cached = this.activeConnectors.get(cacheKey);

    // Return cached connector if it exists and is recent (less than 1 hour old)
    if (cached && this.isCacheValid(cached)) {
      cached.lastUsed = new Date();
      return cached.connector;
    }

    // Create new connector
    const connector = await this.createConnector(channelConfig, credentials);
    return connector;
  }

  /**
   * Check if a cached connector is still valid
   * @param {Object} cached - Cached connector object
   * @returns {boolean} - True if cache is still valid
   */
  isCacheValid(cached) {
    const maxAge = 60 * 60 * 1000; // 1 hour in milliseconds
    const age = Date.now() - cached.createdAt.getTime();
    return age < maxAge;
  }

  /**
   * Remove a connector from cache
   * @param {string} storeId - Store ID
   * @param {string} channelId - Channel ID
   */
  removeConnector(storeId, channelId) {
    const cacheKey = `${storeId}-${channelId}`;
    this.activeConnectors.delete(cacheKey);
  }

  /**
   * Clear all cached connectors
   */
  clearCache() {
    this.activeConnectors.clear();
  }

  /**
   * Get information about all registered connector types
   * @returns {Array} - Array of connector type information
   */
  getSupportedChannelTypes() {
    return Array.from(this.connectorClasses.keys()).map((type) => {
      const ConnectorClass = this.connectorClasses.get(type);
      return {
        type,
        name: this.getChannelDisplayName(type),
        capabilities: this.getDefaultCapabilities(type),
        requiresCredentials: this.getRequiredCredentials(type),
      };
    });
  }

  /**
   * Get display name for a channel type
   * @param {string} type - Channel type
   * @returns {string} - Display name
   */
  getChannelDisplayName(type) {
    const displayNames = {
      shopify: "Shopify",
      amazon: "Amazon Seller Central",
      ebay: "eBay",
      square: "Square POS",
      custom: "Custom REST API",
    };
    return displayNames[type] || type.toUpperCase();
  }

  /**
   * Get default capabilities for a channel type
   * @param {string} type - Channel type
   * @returns {Array} - Array of capabilities
   */
  getDefaultCapabilities(type) {
    const capabilities = {
      shopify: [
        { name: "inventory_sync", supported: true },
        { name: "order_sync", supported: true },
        { name: "webhook_support", supported: true },
        {
          name: "bulk_operations",
          supported: true,
          limitations: ["max 250 items"],
        },
        { name: "real_time_updates", supported: true },
      ],
      amazon: [
        { name: "inventory_sync", supported: true },
        { name: "order_sync", supported: true },
        { name: "webhook_support", supported: false },
        {
          name: "bulk_operations",
          supported: true,
          limitations: ["max 1000 items"],
        },
        { name: "real_time_updates", supported: false },
      ],
      ebay: [
        { name: "inventory_sync", supported: true },
        { name: "order_sync", supported: true },
        { name: "webhook_support", supported: true },
        {
          name: "bulk_operations",
          supported: true,
          limitations: ["max 25 items"],
        },
        { name: "real_time_updates", supported: true },
      ],
      square: [
        { name: "inventory_sync", supported: true },
        { name: "order_sync", supported: true },
        { name: "webhook_support", supported: true },
        {
          name: "bulk_operations",
          supported: true,
          limitations: ["max 1000 items"],
        },
        { name: "real_time_updates", supported: true },
      ],
      custom: [
        { name: "inventory_sync", supported: true },
        { name: "order_sync", supported: true },
        { name: "webhook_support", supported: true },
        { name: "bulk_operations", supported: true },
        { name: "real_time_updates", supported: true },
      ],
    };
    return capabilities[type] || [];
  }

  /**
   * Get required credentials for a channel type
   * @param {string} type - Channel type
   * @returns {Array} - Array of required credential fields
   */
  getRequiredCredentials(type) {
    const credentialRequirements = {
      shopify: [
        {
          field: "shop_domain",
          label: "Shop Domain",
          type: "text",
          required: true,
        },
        {
          field: "access_token",
          label: "Access Token",
          type: "password",
          required: true,
        },
        {
          field: "api_version",
          label: "API Version",
          type: "select",
          required: false,
          default: "2023-10",
        },
      ],
      amazon: [
        {
          field: "merchant_id",
          label: "Merchant ID",
          type: "text",
          required: true,
        },
        {
          field: "marketplace_id",
          label: "Marketplace ID",
          type: "text",
          required: true,
        },
        {
          field: "access_key_id",
          label: "Access Key ID",
          type: "text",
          required: true,
        },
        {
          field: "secret_access_key",
          label: "Secret Access Key",
          type: "password",
          required: true,
        },
        {
          field: "region",
          label: "AWS Region",
          type: "select",
          required: true,
          default: "us-east-1",
        },
      ],
      ebay: [
        { field: "app_id", label: "App ID", type: "text", required: true },
        { field: "dev_id", label: "Dev ID", type: "text", required: true },
        {
          field: "cert_id",
          label: "Cert ID",
          type: "password",
          required: true,
        },
        {
          field: "token",
          label: "User Token",
          type: "password",
          required: true,
        },
        {
          field: "site_id",
          label: "Site ID",
          type: "select",
          required: true,
          default: "0",
        },
      ],
      square: [
        {
          field: "application_id",
          label: "Application ID",
          type: "text",
          required: true,
        },
        {
          field: "access_token",
          label: "Access Token",
          type: "password",
          required: true,
        },
        {
          field: "location_id",
          label: "Location ID",
          type: "text",
          required: true,
        },
        {
          field: "environment",
          label: "Environment",
          type: "select",
          required: true,
          default: "production",
        },
      ],
      custom: [
        {
          field: "base_url",
          label: "API Base URL",
          type: "url",
          required: true,
        },
        {
          field: "auth_type",
          label: "Authentication Type",
          type: "select",
          required: true,
        },
        {
          field: "api_key",
          label: "API Key",
          type: "password",
          required: false,
        },
        {
          field: "bearer_token",
          label: "Bearer Token",
          type: "password",
          required: false,
        },
        { field: "username", label: "Username", type: "text", required: false },
        {
          field: "password",
          label: "Password",
          type: "password",
          required: false,
        },
      ],
    };
    return credentialRequirements[type] || [];
  }

  /**
   * Register a new channel connector type
   * @param {string} type - Channel type identifier
   * @param {Class} ConnectorClass - Connector class that extends ChannelConnector
   */
  registerConnector(type, ConnectorClass) {
    if (!ConnectorClass.prototype instanceof ChannelConnector) {
      throw new Error("Connector class must extend ChannelConnector");
    }
    this.connectorClasses.set(type, ConnectorClass);
  }

  /**
   * Unregister a channel connector type
   * @param {string} type - Channel type identifier
   */
  unregisterConnector(type) {
    this.connectorClasses.delete(type);
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache statistics
   */
  getCacheStats() {
    const stats = {
      totalConnectors: this.activeConnectors.size,
      connectorsByType: {},
      oldestConnector: null,
      newestConnector: null,
    };

    for (const [key, cached] of this.activeConnectors) {
      const type = cached.connector.channelType;
      stats.connectorsByType[type] = (stats.connectorsByType[type] || 0) + 1;

      if (!stats.oldestConnector || cached.createdAt < stats.oldestConnector) {
        stats.oldestConnector = cached.createdAt;
      }

      if (!stats.newestConnector || cached.createdAt > stats.newestConnector) {
        stats.newestConnector = cached.createdAt;
      }
    }

    return stats;
  }

  /**
   * Cleanup expired connectors from cache
   */
  cleanupExpiredConnectors() {
    const expired = [];
    for (const [key, cached] of this.activeConnectors) {
      if (!this.isCacheValid(cached)) {
        expired.push(key);
      }
    }

    for (const key of expired) {
      this.activeConnectors.delete(key);
    }

    return expired.length;
  }
}

module.exports = ChannelFactory;
