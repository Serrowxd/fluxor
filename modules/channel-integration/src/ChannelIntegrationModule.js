const EventEmitter = require('events');
const SyncOrchestrator = require('./services/SyncOrchestrator');
const ConflictResolver = require('./services/ConflictResolver');
const WebhookHandler = require('./services/WebhookHandler');
const RateLimiter = require('./services/RateLimiter');
const ChannelAdapterRegistry = require('./adapters/ChannelAdapterRegistry');

class ChannelIntegrationModule extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      syncInterval: options.syncInterval || 300000, // 5 minutes
      webhookTimeout: options.webhookTimeout || 30000,
      maxRetries: options.maxRetries || 3,
      conflictStrategy: options.conflictStrategy || 'latest-wins',
      enableWebhooks: options.enableWebhooks !== false,
      ...options
    };

    this.dependencies = {
      eventBus: null,
      database: null,
      queue: null
    };

    this.adapterRegistry = new ChannelAdapterRegistry();
    this.syncOrchestrator = null;
    this.conflictResolver = null;
    this.webhookHandler = null;
    this.rateLimiter = null;
    this.channels = new Map();
    this.syncJobs = new Map();
  }

  async initialize(dependencies) {
    this.dependencies = {
      ...this.dependencies,
      ...dependencies
    };

    if (!this.dependencies.eventBus) {
      throw new Error('EventBus dependency is required');
    }
    if (!this.dependencies.database) {
      throw new Error('Database dependency is required');
    }
    if (!this.dependencies.queue) {
      throw new Error('Queue dependency is required');
    }

    this.syncOrchestrator = new SyncOrchestrator({
      database: this.dependencies.database,
      queue: this.dependencies.queue,
      eventBus: this.dependencies.eventBus,
      syncInterval: this.options.syncInterval
    });

    this.conflictResolver = new ConflictResolver({
      strategy: this.options.conflictStrategy,
      database: this.dependencies.database
    });

    this.webhookHandler = new WebhookHandler({
      timeout: this.options.webhookTimeout,
      maxRetries: this.options.maxRetries,
      queue: this.dependencies.queue
    });

    this.rateLimiter = new RateLimiter({
      database: this.dependencies.database
    });

    await this._loadChannels();
    await this._registerEventHandlers();
    
    this._registerDefaultAdapters();

    this.emit('initialized');
    return this;
  }

  registerAdapter(type, adapter) {
    this.adapterRegistry.register(type, adapter);
    this.emit('adapter:registered', { type });
  }

  async connectChannel(channelData) {
    const { type, name, config, settings } = channelData;
    
    const AdapterClass = this.adapterRegistry.get(type);
    if (!AdapterClass) {
      throw new Error(`Unknown channel type: ${type}`);
    }

    const adapter = new AdapterClass(config);
    await adapter.connect();

    const channel = {
      id: this._generateChannelId(),
      type,
      name,
      adapter,
      config,
      settings: {
        syncEnabled: true,
        syncInterval: this.options.syncInterval,
        webhookEnabled: this.options.enableWebhooks,
        rateLimits: {},
        fieldMappings: {},
        ...settings
      },
      status: 'connected',
      lastSync: null,
      metrics: {
        syncs: 0,
        errors: 0,
        conflicts: 0
      }
    };

    await this._saveChannel(channel);
    this.channels.set(channel.id, channel);

    if (channel.settings.syncEnabled) {
      await this._scheduleSyncJob(channel);
    }

    if (channel.settings.webhookEnabled) {
      await this._setupWebhooks(channel);
    }

    this.emit('channel:connected', { channelId: channel.id, type, name });
    
    return channel;
  }

  async disconnectChannel(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    if (this.syncJobs.has(channelId)) {
      const job = this.syncJobs.get(channelId);
      job.stop();
      this.syncJobs.delete(channelId);
    }

    await channel.adapter.disconnect();
    channel.status = 'disconnected';
    
    await this._saveChannel(channel);
    
    this.emit('channel:disconnected', { channelId, type: channel.type });
  }

  async syncChannel(channelId, options = {}) {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    if (channel.status !== 'connected') {
      throw new Error(`Channel is not connected: ${channelId}`);
    }

    const syncOptions = {
      fullSync: options.fullSync || false,
      resources: options.resources || ['products', 'inventory', 'orders'],
      direction: options.direction || 'bidirectional',
      ...options
    };

    try {
      channel.status = 'syncing';
      const startTime = Date.now();
      
      const result = await this.syncOrchestrator.executeSync(
        channel,
        syncOptions,
        {
          conflictResolver: this.conflictResolver,
          rateLimiter: this.rateLimiter,
          transformer: this._createTransformer(channel)
        }
      );

      channel.lastSync = new Date();
      channel.metrics.syncs++;
      channel.status = 'connected';
      
      await this._saveChannel(channel);

      this.emit('channel:synced', {
        channelId,
        duration: Date.now() - startTime,
        result
      });

      return result;
    } catch (error) {
      channel.status = 'error';
      channel.metrics.errors++;
      
      await this._saveChannel(channel);

      this.emit('channel:error', {
        channelId,
        error: error.message,
        type: 'sync'
      });

      throw error;
    }
  }

  async handleWebhook(channelId, event, data) {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    if (!channel.settings.webhookEnabled) {
      throw new Error(`Webhooks disabled for channel: ${channelId}`);
    }

    try {
      const result = await this.webhookHandler.process(
        channel,
        event,
        data,
        {
          transformer: this._createTransformer(channel),
          conflictResolver: this.conflictResolver
        }
      );

      this.emit('webhook:processed', {
        channelId,
        event,
        result
      });

      return result;
    } catch (error) {
      this.emit('webhook:error', {
        channelId,
        event,
        error: error.message
      });

      throw error;
    }
  }

  async updateChannelSettings(channelId, settings) {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    const oldSettings = { ...channel.settings };
    channel.settings = { ...channel.settings, ...settings };

    if (oldSettings.syncEnabled !== settings.syncEnabled) {
      if (settings.syncEnabled) {
        await this._scheduleSyncJob(channel);
      } else {
        this._cancelSyncJob(channelId);
      }
    }

    if (settings.syncInterval && oldSettings.syncInterval !== settings.syncInterval) {
      await this._rescheduleSyncJob(channel);
    }

    if (oldSettings.webhookEnabled !== settings.webhookEnabled) {
      if (settings.webhookEnabled) {
        await this._setupWebhooks(channel);
      } else {
        await this._removeWebhooks(channel);
      }
    }

    await this._saveChannel(channel);

    this.emit('channel:updated', { channelId, settings });
  }

  async getChannelStatus(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    const rateLimitStatus = await this.rateLimiter.getStatus(channelId);
    
    return {
      id: channel.id,
      type: channel.type,
      name: channel.name,
      status: channel.status,
      lastSync: channel.lastSync,
      nextSync: this._getNextSyncTime(channelId),
      settings: channel.settings,
      metrics: channel.metrics,
      rateLimits: rateLimitStatus,
      health: await channel.adapter.checkHealth()
    };
  }

  async getChannels(filter = {}) {
    const channels = Array.from(this.channels.values());
    
    return channels.filter(channel => {
      if (filter.type && channel.type !== filter.type) return false;
      if (filter.status && channel.status !== filter.status) return false;
      if (filter.syncEnabled !== undefined && 
          channel.settings.syncEnabled !== filter.syncEnabled) return false;
      return true;
    });
  }

  async testConnection(type, config) {
    const AdapterClass = this.adapterRegistry.get(type);
    if (!AdapterClass) {
      throw new Error(`Unknown channel type: ${type}`);
    }

    const adapter = new AdapterClass(config);
    
    try {
      await adapter.connect();
      const health = await adapter.checkHealth();
      await adapter.disconnect();
      
      return {
        success: true,
        health
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  _createTransformer(channel) {
    return {
      transform: (data, direction) => {
        const mappings = channel.settings.fieldMappings[direction] || {};
        return this._applyFieldMappings(data, mappings);
      },
      
      reverse: (data, direction) => {
        const reverseDirection = direction === 'inbound' ? 'outbound' : 'inbound';
        const mappings = channel.settings.fieldMappings[reverseDirection] || {};
        return this._applyFieldMappings(data, mappings, true);
      }
    };
  }

  _applyFieldMappings(data, mappings, reverse = false) {
    if (!mappings || Object.keys(mappings).length === 0) {
      return data;
    }

    const result = {};
    const map = reverse 
      ? Object.fromEntries(Object.entries(mappings).map(([k, v]) => [v, k]))
      : mappings;

    for (const [sourceField, targetField] of Object.entries(map)) {
      if (sourceField.includes('.')) {
        const value = this._getNestedValue(data, sourceField);
        if (value !== undefined) {
          this._setNestedValue(result, targetField, value);
        }
      } else if (data[sourceField] !== undefined) {
        result[targetField] = data[sourceField];
      }
    }

    for (const [key, value] of Object.entries(data)) {
      if (!map[key] && !Object.values(map).includes(key)) {
        result[key] = value;
      }
    }

    return result;
  }

  _getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  _setNestedValue(obj, path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((current, key) => {
      current[key] = current[key] || {};
      return current[key];
    }, obj);
    target[lastKey] = value;
  }

  async _loadChannels() {
    const channels = await this.dependencies.database.query(
      'SELECT * FROM channels WHERE deleted_at IS NULL'
    );

    for (const channelData of channels) {
      try {
        const AdapterClass = this.adapterRegistry.get(channelData.type);
        if (!AdapterClass) continue;

        const adapter = new AdapterClass(channelData.config);
        if (channelData.status === 'connected') {
          await adapter.connect();
        }

        const channel = {
          ...channelData,
          adapter,
          config: channelData.config,
          settings: channelData.settings,
          metrics: channelData.metrics || {
            syncs: 0,
            errors: 0,
            conflicts: 0
          }
        };

        this.channels.set(channel.id, channel);

        if (channel.status === 'connected' && channel.settings.syncEnabled) {
          await this._scheduleSyncJob(channel);
        }
      } catch (error) {
        console.error(`Failed to load channel ${channelData.id}:`, error);
      }
    }
  }

  async _saveChannel(channel) {
    const data = {
      ...channel,
      adapter: undefined,
      config: JSON.stringify(channel.config),
      settings: JSON.stringify(channel.settings),
      metrics: JSON.stringify(channel.metrics)
    };

    await this.dependencies.database.upsert('channels', data, ['id']);
  }

  async _scheduleSyncJob(channel) {
    if (this.syncJobs.has(channel.id)) {
      this._cancelSyncJob(channel.id);
    }

    const job = await this.dependencies.queue.schedule(
      'channel-sync',
      `*/${Math.floor(channel.settings.syncInterval / 60000)} * * * *`,
      {
        channelId: channel.id,
        type: 'scheduled-sync'
      }
    );

    this.syncJobs.set(channel.id, job);
  }

  async _rescheduleSyncJob(channel) {
    await this._scheduleSyncJob(channel);
  }

  _cancelSyncJob(channelId) {
    const job = this.syncJobs.get(channelId);
    if (job) {
      job.stop();
      this.syncJobs.delete(channelId);
    }
  }

  async _setupWebhooks(channel) {
    if (channel.adapter.setupWebhooks) {
      const webhookUrl = `${this.options.webhookBaseUrl}/channels/${channel.id}/webhook`;
      await channel.adapter.setupWebhooks(webhookUrl);
    }
  }

  async _removeWebhooks(channel) {
    if (channel.adapter.removeWebhooks) {
      await channel.adapter.removeWebhooks();
    }
  }

  _getNextSyncTime(channelId) {
    const job = this.syncJobs.get(channelId);
    if (!job || !job.nextDates) return null;
    
    const nextDates = job.nextDates(1);
    return nextDates.length > 0 ? nextDates[0] : null;
  }

  async _registerEventHandlers() {
    this.dependencies.eventBus.on('inventory:updated', async (event) => {
      for (const channel of this.channels.values()) {
        if (channel.status === 'connected' && 
            channel.settings.syncEnabled &&
            channel.settings.autoSync?.inventory) {
          await this.dependencies.queue.enqueue('channel-sync', {
            channelId: channel.id,
            type: 'inventory-update',
            productId: event.productId
          });
        }
      }
    });

    this.dependencies.eventBus.on('order:created', async (event) => {
      for (const channel of this.channels.values()) {
        if (channel.status === 'connected' && 
            channel.settings.syncEnabled &&
            channel.settings.autoSync?.orders) {
          await this.dependencies.queue.enqueue('channel-sync', {
            channelId: channel.id,
            type: 'order-sync',
            orderId: event.orderId
          });
        }
      }
    });
  }

  _registerDefaultAdapters() {
    const ShopifyAdapter = require('./adapters/ShopifyAdapter');
    const AmazonAdapter = require('./adapters/AmazonAdapter');
    const EbayAdapter = require('./adapters/EbayAdapter');
    const WooCommerceAdapter = require('./adapters/WooCommerceAdapter');

    this.registerAdapter('shopify', ShopifyAdapter);
    this.registerAdapter('amazon', AmazonAdapter);
    this.registerAdapter('ebay', EbayAdapter);
    this.registerAdapter('woocommerce', WooCommerceAdapter);
  }

  _generateChannelId() {
    return `ch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async shutdown() {
    for (const [channelId, job] of this.syncJobs) {
      job.stop();
    }

    for (const channel of this.channels.values()) {
      if (channel.adapter && channel.status === 'connected') {
        await channel.adapter.disconnect();
      }
    }

    this.removeAllListeners();
  }
}

module.exports = ChannelIntegrationModule;