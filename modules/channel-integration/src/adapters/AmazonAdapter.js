const BaseAdapter = require('./BaseAdapter');
const crypto = require('crypto');
const axios = require('axios');

class AmazonAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.validateConfig();
    
    this.region = config.region || 'us-east-1';
    this.marketplace = config.marketplace || 'ATVPDKIKX0DER'; // US marketplace
    this.baseUrl = `https://sellingpartnerapi-${this.region}.amazon.com`;
  }

  validateConfig() {
    if (!this.config.sellerId) {
      throw new Error('Seller ID is required');
    }
    if (!this.config.refreshToken) {
      throw new Error('Refresh token is required');
    }
    if (!this.config.clientId) {
      throw new Error('Client ID is required');
    }
    if (!this.config.clientSecret) {
      throw new Error('Client secret is required');
    }
  }

  async connect() {
    try {
      await this._refreshAccessToken();
      this.connected = true;
      
      const profile = await this._getSellerProfile();
      return profile;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async disconnect() {
    this.connected = false;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async checkHealth() {
    try {
      await this._ensureValidToken();
      
      const response = await this._makeRequest('GET', '/sellers/v1/marketplaceParticipations');
      
      return {
        status: 'healthy',
        marketplaces: response.payload.length,
        sellerId: this.config.sellerId
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: this.normalizeError(error)
      };
    }
  }

  async fetchResources(resource, options = {}) {
    await this._ensureValidToken();
    
    switch (resource) {
      case 'products':
        return await this._fetchProducts(options);
      case 'inventory':
        return await this._fetchInventory(options);
      case 'orders':
        return await this._fetchOrders(options);
      default:
        throw new Error(`Unsupported resource: ${resource}`);
    }
  }

  async createResource(resource, data) {
    await this._ensureValidToken();
    
    switch (resource) {
      case 'products':
        return await this._createProduct(data);
      case 'inventory':
        return await this._updateInventory(data);
      default:
        throw new Error(`Create not supported for resource: ${resource}`);
    }
  }

  async updateResource(resource, id, data) {
    await this._ensureValidToken();
    
    switch (resource) {
      case 'products':
        return await this._updateProduct(id, data);
      case 'inventory':
        return await this._updateInventory({ ...data, sku: id });
      case 'orders':
        return await this._updateOrder(id, data);
      default:
        throw new Error(`Update not supported for resource: ${resource}`);
    }
  }

  async deleteResource(resource, id) {
    throw new Error('Delete operations not supported by Amazon SP-API');
  }

  async setupWebhooks(webhookUrl) {
    await this._ensureValidToken();
    
    const notifications = [
      'ITEM_INVENTORY_EVENT_CHANGE',
      'ORDER_CHANGE',
      'FEED_PROCESSING_FINISHED',
      'REPORT_PROCESSING_FINISHED'
    ];

    const results = [];

    for (const notificationType of notifications) {
      try {
        const subscription = await this._createSubscription(notificationType, webhookUrl);
        results.push(subscription);
      } catch (error) {
        console.error(`Failed to create subscription for ${notificationType}:`, error.message);
      }
    }

    return results;
  }

  async removeWebhooks() {
    await this._ensureValidToken();
    
    const subscriptions = await this._getSubscriptions();
    const results = [];

    for (const subscription of subscriptions) {
      try {
        await this._deleteSubscription(subscription.subscriptionId);
        results.push({ id: subscription.subscriptionId, deleted: true });
      } catch (error) {
        results.push({ 
          id: subscription.subscriptionId, 
          deleted: false, 
          error: error.message 
        });
      }
    }

    return results;
  }

  async _fetchProducts(options) {
    const params = {
      MarketplaceIds: this.marketplace,
      Query: options.query || '',
      QueryType: 'KEYWORD',
      MaxResults: options.limit || 20
    };

    if (options.nextToken) {
      params.NextToken = options.nextToken;
    }

    const response = await this._makeRequest(
      'GET',
      '/catalog/v0/items',
      params
    );

    return response.payload.Items.map(item => ({
      id: item.Identifiers.MarketplaceASIN.ASIN,
      sku: item.Identifiers.SKUIdentifier?.SellerSKU,
      title: item.AttributeSets[0]?.Title,
      price: item.AttributeSets[0]?.ListPrice?.Amount,
      images: item.AttributeSets[0]?.SmallImage ? [{
        url: item.AttributeSets[0].SmallImage.URL
      }] : []
    }));
  }

  async _fetchInventory(options) {
    const params = {
      sellerId: this.config.sellerId,
      marketplaceIds: this.marketplace,
      maxResults: options.limit || 50
    };

    if (options.nextToken) {
      params.nextToken = options.nextToken;
    }

    const response = await this._makeRequest(
      'GET',
      '/fba/inventory/v1/summaries',
      params
    );

    return response.payload.inventorySummaries.map(item => ({
      sku: item.sellerSku,
      asin: item.asin,
      quantity: item.totalQuantity,
      fulfillableQuantity: item.inventoryDetails.fulfillableQuantity,
      inboundQuantity: item.inventoryDetails.inboundWorkingQuantity +
                      item.inventoryDetails.inboundShippedQuantity +
                      item.inventoryDetails.inboundReceivingQuantity
    }));
  }

  async _fetchOrders(options) {
    const params = {
      MarketplaceIds: [this.marketplace],
      MaxResultsPerPage: options.limit || 100
    };

    if (options.since) {
      params.CreatedAfter = options.since.toISOString();
    } else {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      params.CreatedAfter = yesterday.toISOString();
    }

    if (options.nextToken) {
      params.NextToken = options.nextToken;
    }

    const response = await this._makeRequest(
      'GET',
      '/orders/v0/orders',
      params
    );

    return response.payload.Orders.map(order => ({
      id: order.AmazonOrderId,
      status: order.OrderStatus,
      purchaseDate: order.PurchaseDate,
      total: order.OrderTotal?.Amount,
      currency: order.OrderTotal?.CurrencyCode,
      customer: {
        email: order.BuyerEmail,
        name: order.BuyerName
      },
      shippingAddress: order.ShippingAddress
    }));
  }

  async _createProduct(data) {
    throw new Error('Product creation requires feed submission - not implemented');
  }

  async _updateProduct(id, data) {
    throw new Error('Product updates require feed submission - not implemented');
  }

  async _updateInventory(data) {
    const feeds = [{
      messageType: 'INVENTORY',
      messages: [{
        sku: data.sku,
        quantity: data.quantity,
        fulfillmentLatency: data.fulfillmentLatency || 1
      }]
    }];

    return await this._submitFeed('POST_INVENTORY_AVAILABILITY_DATA', feeds);
  }

  async _updateOrder(id, data) {
    if (data.status === 'shipped') {
      return await this._confirmShipment(id, data);
    }
    
    throw new Error(`Order status update not supported: ${data.status}`);
  }

  async _confirmShipment(orderId, data) {
    const payload = {
      marketplaceId: this.marketplace,
      shipmentStatus: 'Shipped',
      trackingNumber: data.trackingNumber,
      carrierCode: data.carrierCode || 'Other',
      shipDate: new Date().toISOString()
    };

    return await this._makeRequest(
      'POST',
      `/orders/v0/orders/${orderId}/shipmentConfirmation`,
      null,
      payload
    );
  }

  async _submitFeed(feedType, content) {
    throw new Error('Feed submission not implemented');
  }

  async _createSubscription(notificationType, webhookUrl) {
    const payload = {
      payloadVersion: '1.0',
      destinationId: await this._getOrCreateDestination(webhookUrl),
      processingDirective: {
        eventFilter: {
          eventFilterType: 'ANY_OFFER_CHANGED',
          marketplaceIds: [this.marketplace]
        }
      }
    };

    return await this._makeRequest(
      'POST',
      `/notifications/v1/subscriptions/${notificationType}`,
      null,
      payload
    );
  }

  async _getSubscriptions() {
    const response = await this._makeRequest(
      'GET',
      '/notifications/v1/subscriptions'
    );

    return response.payload || [];
  }

  async _deleteSubscription(subscriptionId) {
    return await this._makeRequest(
      'DELETE',
      `/notifications/v1/subscriptions/${subscriptionId}`
    );
  }

  async _getOrCreateDestination(webhookUrl) {
    const destinations = await this._getDestinations();
    
    const existing = destinations.find(d => 
      d.resource.url === webhookUrl
    );

    if (existing) {
      return existing.destinationId;
    }

    const payload = {
      resourceSpecification: {
        url: webhookUrl,
        method: 'POST'
      }
    };

    const response = await this._makeRequest(
      'POST',
      '/notifications/v1/destinations',
      null,
      payload
    );

    return response.payload.destinationId;
  }

  async _getDestinations() {
    const response = await this._makeRequest(
      'GET',
      '/notifications/v1/destinations'
    );

    return response.payload || [];
  }

  async _getSellerProfile() {
    const response = await this._makeRequest(
      'GET',
      '/sellers/v1/marketplaceParticipations'
    );

    return {
      sellerId: this.config.sellerId,
      marketplaces: response.payload.map(p => ({
        id: p.marketplace.id,
        name: p.marketplace.name,
        countryCode: p.marketplace.countryCode
      }))
    };
  }

  async _makeRequest(method, path, params = null, data = null) {
    const url = `${this.baseUrl}${path}`;
    const timestamp = new Date().toISOString();
    
    const headers = {
      'x-amz-access-token': this.accessToken,
      'x-amz-date': timestamp,
      'Content-Type': 'application/json'
    };

    try {
      const response = await axios({
        method,
        url,
        headers,
        params,
        data
      });

      return response.data;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async _refreshAccessToken() {
    const response = await axios.post('https://api.amazon.com/auth/o2/token', {
      grant_type: 'refresh_token',
      refresh_token: this.config.refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret
    });

    this.accessToken = response.data.access_token;
    this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
  }

  async _ensureValidToken() {
    if (!this.accessToken || Date.now() >= this.tokenExpiry - 60000) {
      await this._refreshAccessToken();
    }
  }
}

module.exports = AmazonAdapter;