const BaseAdapter = require('./BaseAdapter');
const axios = require('axios');

class WooCommerceAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.validateConfig();
    
    this.baseUrl = `${config.url}/wp-json/wc/${config.version || 'v3'}`;
    this.auth = {
      username: config.consumerKey,
      password: config.consumerSecret
    };
  }

  validateConfig() {
    if (!this.config.url) {
      throw new Error('Store URL is required');
    }
    if (!this.config.consumerKey) {
      throw new Error('Consumer key is required');
    }
    if (!this.config.consumerSecret) {
      throw new Error('Consumer secret is required');
    }
  }

  async connect() {
    try {
      const response = await this._makeRequest('GET', '/system_status');
      this.storeInfo = response.environment;
      this.connected = true;
      
      return {
        storeName: this.storeInfo.site_url,
        version: this.storeInfo.version,
        currency: response.settings.currency,
        timezone: response.settings.timezone
      };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async disconnect() {
    this.connected = false;
    this.storeInfo = null;
  }

  async checkHealth() {
    try {
      const response = await this._makeRequest('GET', '/system_status');
      
      return {
        status: 'healthy',
        version: response.environment.version,
        database: response.database.wc_database_version,
        activePlugins: response.active_plugins.length
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
      const response = await this._makeRequest('GET', `/${endpoint}`, params);
      return this._normalizeResources(response, resource);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async createResource(resource, data) {
    const endpoint = this._getEndpoint(resource);
    const payload = this._preparePayload(resource, data);
    
    try {
      const response = await this._makeRequest('POST', `/${endpoint}`, null, payload);
      return this._normalizeResource(response, resource);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async updateResource(resource, id, data) {
    const endpoint = this._getEndpoint(resource);
    const payload = this._preparePayload(resource, data);
    
    try {
      const response = await this._makeRequest('PUT', `/${endpoint}/${id}`, null, payload);
      return this._normalizeResource(response, resource);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async deleteResource(resource, id) {
    const endpoint = this._getEndpoint(resource);
    
    try {
      await this._makeRequest('DELETE', `/${endpoint}/${id}`, { force: true });
      return { deleted: true, id };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async setupWebhooks(webhookUrl) {
    const topics = [
      'product.created',
      'product.updated',
      'product.deleted',
      'order.created',
      'order.updated',
      'order.deleted',
      'customer.created',
      'customer.updated'
    ];

    const results = [];

    for (const topic of topics) {
      try {
        const webhook = await this._makeRequest('POST', '/webhooks', null, {
          name: `Fluxor ${topic}`,
          topic,
          delivery_url: `${webhookUrl}?topic=${topic}`,
          secret: this.config.webhookSecret || 'fluxor-secret',
          status: 'active'
        });
        
        results.push(webhook);
      } catch (error) {
        console.error(`Failed to create webhook for ${topic}:`, error.message);
      }
    }

    return results;
  }

  async removeWebhooks() {
    try {
      const webhooks = await this._makeRequest('GET', '/webhooks');
      const results = [];

      for (const webhook of webhooks) {
        try {
          await this._makeRequest('DELETE', `/webhooks/${webhook.id}`, { force: true });
          results.push({ id: webhook.id, deleted: true });
        } catch (error) {
          results.push({ id: webhook.id, deleted: false, error: error.message });
        }
      }

      return results;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  _getEndpoint(resource) {
    const endpoints = {
      products: 'products',
      inventory: 'products',
      orders: 'orders',
      customers: 'customers',
      categories: 'products/categories',
      variations: 'products/variations'
    };
    
    return endpoints[resource] || resource;
  }

  _buildParams(resource, options) {
    const params = {
      per_page: options.limit || 100,
      page: options.page || 1
    };

    if (options.since) {
      params.modified_after = options.since.toISOString();
    }

    if (resource === 'orders' && options.status) {
      params.status = options.status;
    }

    if (resource === 'products' && options.type) {
      params.type = options.type;
    }

    return params;
  }

  _preparePayload(resource, data) {
    switch (resource) {
      case 'products':
        return {
          name: data.name || data.title,
          description: data.description,
          short_description: data.shortDescription,
          sku: data.sku,
          regular_price: data.price?.toString(),
          manage_stock: true,
          stock_quantity: data.quantity,
          categories: data.categories?.map(cat => ({ id: cat })),
          images: data.images?.map(img => ({ src: img.url })),
          attributes: data.attributes,
          variations: data.variations
        };

      case 'inventory':
        return {
          manage_stock: true,
          stock_quantity: data.quantity,
          stock_status: data.quantity > 0 ? 'instock' : 'outofstock'
        };

      case 'orders':
        return {
          status: data.status,
          billing: data.billing,
          shipping: data.shipping,
          line_items: data.items?.map(item => ({
            product_id: item.productId,
            quantity: item.quantity,
            price: item.price
          })),
          shipping_lines: data.shippingLines,
          fee_lines: data.feeLines,
          coupon_lines: data.couponLines
        };

      case 'customers':
        return {
          email: data.email,
          first_name: data.firstName,
          last_name: data.lastName,
          username: data.username,
          billing: data.billing,
          shipping: data.shipping
        };

      default:
        return data;
    }
  }

  _normalizeResources(resources, type) {
    return resources.map(resource => this._normalizeResource(resource, type));
  }

  _normalizeResource(resource, type) {
    switch (type) {
      case 'products':
        return {
          id: resource.id,
          sku: resource.sku,
          name: resource.name,
          description: resource.description,
          price: parseFloat(resource.regular_price || resource.price || 0),
          salePrice: parseFloat(resource.sale_price || 0),
          quantity: resource.stock_quantity || 0,
          status: resource.status,
          type: resource.type,
          images: resource.images?.map(img => ({
            id: img.id,
            url: img.src,
            alt: img.alt
          })),
          categories: resource.categories?.map(cat => ({
            id: cat.id,
            name: cat.name
          })),
          attributes: resource.attributes,
          variations: resource.variations,
          createdAt: resource.date_created,
          updatedAt: resource.date_modified
        };

      case 'inventory':
        return {
          id: resource.id,
          sku: resource.sku,
          quantity: resource.stock_quantity || 0,
          status: resource.stock_status,
          manageStock: resource.manage_stock
        };

      case 'orders':
        return {
          id: resource.id,
          number: resource.number,
          status: resource.status,
          total: parseFloat(resource.total),
          currency: resource.currency,
          customer: {
            id: resource.customer_id,
            email: resource.billing?.email,
            firstName: resource.billing?.first_name,
            lastName: resource.billing?.last_name
          },
          items: resource.line_items?.map(item => ({
            id: item.id,
            productId: item.product_id,
            name: item.name,
            sku: item.sku,
            quantity: item.quantity,
            price: parseFloat(item.price),
            total: parseFloat(item.total)
          })),
          billing: resource.billing,
          shipping: resource.shipping,
          paymentMethod: resource.payment_method,
          transactionId: resource.transaction_id,
          createdAt: resource.date_created,
          updatedAt: resource.date_modified
        };

      case 'customers':
        return {
          id: resource.id,
          email: resource.email,
          username: resource.username,
          firstName: resource.first_name,
          lastName: resource.last_name,
          role: resource.role,
          billing: resource.billing,
          shipping: resource.shipping,
          ordersCount: resource.orders_count,
          totalSpent: parseFloat(resource.total_spent),
          createdAt: resource.date_created,
          updatedAt: resource.date_modified
        };

      default:
        return resource;
    }
  }

  async _makeRequest(method, path, params = null, data = null) {
    const config = {
      method,
      url: `${this.baseUrl}${path}`,
      auth: this.auth,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Fluxor-WooCommerce-Adapter/1.0'
      }
    };

    if (params) {
      config.params = params;
    }

    if (data) {
      config.data = data;
    }

    try {
      const response = await axios(config);
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        throw new Error('Authentication failed. Please check your API credentials.');
      }
      throw error;
    }
  }

  async getBatchSupport() {
    return {
      products: { create: 100, update: 100, delete: 100 },
      orders: { create: 100, update: 100, delete: 100 },
      customers: { create: 100, update: 100, delete: 100 }
    };
  }

  async batchOperation(resource, operations) {
    const endpoint = this._getEndpoint(resource);
    const batch = {
      create: [],
      update: [],
      delete: []
    };

    for (const op of operations) {
      if (op.type === 'create') {
        batch.create.push(this._preparePayload(resource, op.data));
      } else if (op.type === 'update') {
        batch.update.push({
          id: op.id,
          ...this._preparePayload(resource, op.data)
        });
      } else if (op.type === 'delete') {
        batch.delete.push(op.id);
      }
    }

    try {
      const response = await this._makeRequest('POST', `/${endpoint}/batch`, null, batch);
      
      return {
        created: response.create?.map(r => this._normalizeResource(r, resource)),
        updated: response.update?.map(r => this._normalizeResource(r, resource)),
        deleted: response.delete
      };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }
}

module.exports = WooCommerceAdapter;