class WebhookHandler {
  constructor(options) {
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries || 3;
    this.queue = options.queue;
    this.processors = new Map();
    
    this._registerDefaultProcessors();
  }

  async process(channel, event, data, services) {
    const { transformer, conflictResolver } = services;
    
    const webhookLog = {
      id: this._generateWebhookId(),
      channelId: channel.id,
      event,
      data: JSON.stringify(data),
      status: 'processing',
      receivedAt: new Date()
    };

    await this._saveWebhookLog(webhookLog);

    try {
      const processor = this._getProcessor(channel.type, event);
      if (!processor) {
        throw new Error(`No processor found for ${channel.type}:${event}`);
      }

      const result = await Promise.race([
        processor(channel, data, { transformer, conflictResolver }),
        this._timeout(this.timeout)
      ]);

      webhookLog.status = 'completed';
      webhookLog.processedAt = new Date();
      webhookLog.result = JSON.stringify(result);
      
      await this._saveWebhookLog(webhookLog);

      return result;
    } catch (error) {
      webhookLog.status = 'failed';
      webhookLog.processedAt = new Date();
      webhookLog.error = error.message;
      
      await this._saveWebhookLog(webhookLog);

      if (webhookLog.attempts < this.maxRetries) {
        await this._scheduleRetry(channel, event, data, webhookLog);
      }

      throw error;
    }
  }

  registerProcessor(channelType, event, processor) {
    const key = `${channelType}:${event}`;
    this.processors.set(key, processor);
  }

  _registerDefaultProcessors() {
    this.registerProcessor('shopify', 'products/create', async (channel, data, services) => {
      const product = services.transformer.transform(data, 'inbound');
      
      return await this.queue.enqueue('channel-sync', {
        channelId: channel.id,
        type: 'webhook',
        event: 'product-created',
        resource: 'products',
        data: product
      });
    });

    this.registerProcessor('shopify', 'products/update', async (channel, data, services) => {
      const product = services.transformer.transform(data, 'inbound');
      
      return await this.queue.enqueue('channel-sync', {
        channelId: channel.id,
        type: 'webhook',
        event: 'product-updated',
        resource: 'products',
        data: product
      });
    });

    this.registerProcessor('shopify', 'orders/create', async (channel, data, services) => {
      const order = services.transformer.transform(data, 'inbound');
      
      return await this.queue.enqueue('channel-sync', {
        channelId: channel.id,
        type: 'webhook',
        event: 'order-created',
        resource: 'orders',
        data: order,
        priority: 5
      });
    });

    this.registerProcessor('shopify', 'inventory_levels/update', async (channel, data, services) => {
      const inventory = services.transformer.transform(data, 'inbound');
      
      return await this.queue.enqueue('channel-sync', {
        channelId: channel.id,
        type: 'webhook',
        event: 'inventory-updated',
        resource: 'inventory',
        data: inventory,
        priority: 8
      });
    });

    this.registerProcessor('amazon', 'ITEM_INVENTORY_EVENT_CHANGE', async (channel, data, services) => {
      const inventory = services.transformer.transform(data.Payload, 'inbound');
      
      return await this.queue.enqueue('channel-sync', {
        channelId: channel.id,
        type: 'webhook',
        event: 'inventory-changed',
        resource: 'inventory',
        data: inventory
      });
    });

    this.registerProcessor('amazon', 'ORDER_CHANGE', async (channel, data, services) => {
      const order = services.transformer.transform(data.Payload, 'inbound');
      
      return await this.queue.enqueue('channel-sync', {
        channelId: channel.id,
        type: 'webhook',
        event: 'order-changed',
        resource: 'orders',
        data: order,
        priority: 5
      });
    });

    this.registerProcessor('woocommerce', 'product.created', async (channel, data, services) => {
      const product = services.transformer.transform(data, 'inbound');
      
      return await this.queue.enqueue('channel-sync', {
        channelId: channel.id,
        type: 'webhook',
        event: 'product-created',
        resource: 'products',
        data: product
      });
    });

    this.registerProcessor('woocommerce', 'order.created', async (channel, data, services) => {
      const order = services.transformer.transform(data, 'inbound');
      
      return await this.queue.enqueue('channel-sync', {
        channelId: channel.id,
        type: 'webhook',
        event: 'order-created',
        resource: 'orders',
        data: order,
        priority: 5
      });
    });

    this.registerProcessor('ebay', 'ItemRevised', async (channel, data, services) => {
      const product = services.transformer.transform(data.Item, 'inbound');
      
      return await this.queue.enqueue('channel-sync', {
        channelId: channel.id,
        type: 'webhook',
        event: 'item-revised',
        resource: 'products',
        data: product
      });
    });

    this.registerProcessor('ebay', 'FixedPriceTransaction', async (channel, data, services) => {
      const order = services.transformer.transform(data.Transaction, 'inbound');
      
      return await this.queue.enqueue('channel-sync', {
        channelId: channel.id,
        type: 'webhook',
        event: 'transaction-created',
        resource: 'orders',
        data: order,
        priority: 5
      });
    });
  }

  _getProcessor(channelType, event) {
    const key = `${channelType}:${event}`;
    return this.processors.get(key);
  }

  async _scheduleRetry(channel, event, data, webhookLog) {
    const delay = Math.pow(2, webhookLog.attempts || 1) * 1000;
    
    await this.queue.enqueue('webhook-retry', {
      channelId: channel.id,
      event,
      data,
      webhookLogId: webhookLog.id,
      attempt: (webhookLog.attempts || 0) + 1
    }, {
      delay,
      priority: 3
    });
  }

  async _saveWebhookLog(webhookLog) {
    if (this.queue && this.queue.dependencies?.database) {
      await this.queue.dependencies.database.upsert(
        'channel_webhook_logs',
        webhookLog,
        ['id']
      );
    }
  }

  _timeout(ms) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Webhook processing timeout')), ms);
    });
  }

  _generateWebhookId() {
    return `wh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async getWebhookLogs(channelId, options = {}) {
    const { event, status, limit = 100, offset = 0 } = options;
    
    let query = `
      SELECT * FROM channel_webhook_logs 
      WHERE channel_id = $1
    `;
    const params = [channelId];
    
    if (event) {
      query += ` AND event = $${params.length + 1}`;
      params.push(event);
    }
    
    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }
    
    query += ` ORDER BY received_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    if (this.queue && this.queue.dependencies?.database) {
      return await this.queue.dependencies.database.query(query, params);
    }
    
    return [];
  }

  async retryWebhook(webhookLogId) {
    if (!this.queue || !this.queue.dependencies?.database) {
      throw new Error('Database not available');
    }

    const webhookLog = await this.queue.dependencies.database.queryOne(
      'SELECT * FROM channel_webhook_logs WHERE id = $1',
      [webhookLogId]
    );

    if (!webhookLog) {
      throw new Error(`Webhook log not found: ${webhookLogId}`);
    }

    if (webhookLog.status === 'completed') {
      throw new Error('Cannot retry completed webhook');
    }

    const data = JSON.parse(webhookLog.data);
    
    await this.queue.enqueue('webhook-retry', {
      channelId: webhookLog.channel_id,
      event: webhookLog.event,
      data,
      webhookLogId,
      attempt: (webhookLog.attempts || 0) + 1
    }, {
      priority: 5
    });

    return { queued: true, webhookLogId };
  }
}

module.exports = WebhookHandler;