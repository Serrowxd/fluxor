const BaseAdapter = require('./BaseAdapter');
const axios = require('axios');

class ShopifyAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.validateConfig();
    
    this.baseUrl = `https://${config.shop}.myshopify.com/admin/api/${config.apiVersion || '2024-01'}`;
    this.headers = {
      'X-Shopify-Access-Token': config.accessToken,
      'Content-Type': 'application/json'
    };
  }

  validateConfig() {
    if (!this.config.shop) {
      throw new Error('Shop domain is required');
    }
    if (!this.config.accessToken) {
      throw new Error('Access token is required');
    }
  }

  async connect() {
    try {
      const response = await axios.get(`${this.baseUrl}/shop.json`, {
        headers: this.headers
      });
      
      this.shopInfo = response.data.shop;
      this.connected = true;
      
      return this.shopInfo;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async disconnect() {
    this.connected = false;
    this.shopInfo = null;
  }

  async checkHealth() {
    try {
      const response = await axios.get(`${this.baseUrl}/shop.json`, {
        headers: this.headers
      });
      
      return {
        status: 'healthy',
        shop: response.data.shop.name,
        plan: response.data.shop.plan_name,
        currency: response.data.shop.currency,
        timezone: response.data.shop.timezone
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: this.normalizeError(error)
      };
    }
  }

  async fetchResources(resource, options = {}) {
    const endpoint = this._getEndpoint(resource);
    const params = this._buildParams(resource, options);
    
    try {
      const response = await axios.get(`${this.baseUrl}/${endpoint}.json`, {
        headers: this.headers,
        params
      });
      
      return this._extractResources(response.data, resource);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async createResource(resource, data) {
    const endpoint = this._getEndpoint(resource);
    const payload = this._wrapResource(resource, data);
    
    try {
      const response = await axios.post(
        `${this.baseUrl}/${endpoint}.json`,
        payload,
        { headers: this.headers }
      );
      
      return this._extractResource(response.data, resource);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async updateResource(resource, id, data) {
    const endpoint = this._getEndpoint(resource);
    const payload = this._wrapResource(resource, data);
    
    try {
      const response = await axios.put(
        `${this.baseUrl}/${endpoint}/${id}.json`,
        payload,
        { headers: this.headers }
      );
      
      return this._extractResource(response.data, resource);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async deleteResource(resource, id) {
    const endpoint = this._getEndpoint(resource);
    
    try {
      await axios.delete(
        `${this.baseUrl}/${endpoint}/${id}.json`,
        { headers: this.headers }
      );
      
      return { deleted: true, id };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async setupWebhooks(webhookUrl) {
    const topics = [
      'products/create',
      'products/update',
      'products/delete',
      'inventory_levels/update',
      'orders/create',
      'orders/updated',
      'orders/cancelled',
      'orders/fulfilled'
    ];

    const existingWebhooks = await this._getWebhooks();
    const results = [];

    for (const topic of topics) {
      const existing = existingWebhooks.find(w => w.topic === topic);
      
      if (existing) {
        results.push(existing);
        continue;
      }

      try {
        const webhook = await axios.post(
          `${this.baseUrl}/webhooks.json`,
          {
            webhook: {
              topic,
              address: `${webhookUrl}?topic=${topic}`,
              format: 'json'
            }
          },
          { headers: this.headers }
        );
        
        results.push(webhook.data.webhook);
      } catch (error) {
        console.error(`Failed to create webhook for ${topic}:`, error.message);
      }
    }

    return results;
  }

  async removeWebhooks() {
    const webhooks = await this._getWebhooks();
    const results = [];

    for (const webhook of webhooks) {
      try {
        await axios.delete(
          `${this.baseUrl}/webhooks/${webhook.id}.json`,
          { headers: this.headers }
        );
        
        results.push({ id: webhook.id, deleted: true });
      } catch (error) {
        results.push({ id: webhook.id, deleted: false, error: error.message });
      }
    }

    return results;
  }

  async _getWebhooks() {
    try {
      const response = await axios.get(`${this.baseUrl}/webhooks.json`, {
        headers: this.headers
      });
      
      return response.data.webhooks;
    } catch (error) {
      return [];
    }
  }

  _getEndpoint(resource) {
    const endpoints = {
      products: 'products',
      inventory: 'inventory_levels',
      orders: 'orders',
      customers: 'customers',
      collections: 'custom_collections',
      variants: 'variants'
    };
    
    return endpoints[resource] || resource;
  }

  _buildParams(resource, options) {
    const params = {
      limit: options.limit || 250,
      page: options.page || 1
    };

    if (options.since) {
      params.updated_at_min = options.since.toISOString();
    }

    if (resource === 'inventory' && options.location_ids) {
      params.location_ids = options.location_ids.join(',');
    }

    if (resource === 'orders' && options.status) {
      params.status = options.status;
    }

    return params;
  }

  _wrapResource(resource, data) {
    const wrappers = {
      products: 'product',
      inventory: 'inventory_level',
      orders: 'order',
      customers: 'customer',
      collections: 'custom_collection',
      variants: 'variant'
    };
    
    const wrapper = wrappers[resource] || resource;
    return { [wrapper]: data };
  }

  _extractResources(data, resource) {
    const keys = {
      products: 'products',
      inventory: 'inventory_levels',
      orders: 'orders',
      customers: 'customers',
      collections: 'custom_collections',
      variants: 'variants'
    };
    
    const key = keys[resource] || resource;
    return data[key] || [];
  }

  _extractResource(data, resource) {
    const keys = {
      products: 'product',
      inventory: 'inventory_level',
      orders: 'order',
      customers: 'customer',
      collections: 'custom_collection',
      variants: 'variant'
    };
    
    const key = keys[resource] || resource;
    return data[key];
  }
}

module.exports = ShopifyAdapter;