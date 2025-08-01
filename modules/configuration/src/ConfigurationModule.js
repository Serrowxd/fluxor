const Joi = require('joi');
const EventEmitter = require('events');
const EnvironmentProvider = require('./providers/EnvironmentProvider');
const FileProvider = require('./providers/FileProvider');
const DatabaseProvider = require('./providers/DatabaseProvider');
const FeatureFlagService = require('./services/FeatureFlagService');
const { ConfigurationSource, ConfigurationScope } = require('./types');

class ConfigurationModule extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.providers = new Map();
    this.cache = new Map();
    this.schemas = new Map();
    this.defaults = new Map();
    this.watchers = [];
    this.featureFlagService = null;
    this.initialized = false;
  }

  async initialize(dependencies = {}) {
    if (this.initialized) {
      return;
    }

    // Initialize providers
    await this.initializeProviders(dependencies);

    // Initialize feature flag service
    if (this.config.featureFlags?.enabled !== false) {
      this.featureFlagService = new FeatureFlagService(
        this.config.featureFlags || {},
        {
          database: dependencies.database,
          cache: dependencies.cache,
          eventBus: dependencies.eventBus
        }
      );
      await this.featureFlagService.initialize();
    }

    // Load initial configurations
    if (this.config.preload) {
      await this.preloadConfigurations();
    }

    this.initialized = true;
  }

  async initializeProviders(dependencies) {
    const providerConfigs = this.config.providers || {};

    // Environment provider (highest priority by default)
    if (providerConfigs.environment?.enabled !== false) {
      const envProvider = new EnvironmentProvider(providerConfigs.environment || {});
      await envProvider.initialize();
      this.registerProvider('environment', envProvider, providerConfigs.environment?.priority || 100);
    }

    // File provider
    if (providerConfigs.file?.enabled !== false) {
      const fileProvider = new FileProvider(providerConfigs.file || {});
      await fileProvider.initialize();
      this.registerProvider('file', fileProvider, providerConfigs.file?.priority || 50);
      
      // Set up change watching
      if (providerConfigs.file?.watch !== false) {
        fileProvider.watch(this.handleConfigChange.bind(this));
      }
    }

    // Database provider
    if (providerConfigs.database?.enabled !== false && dependencies.database) {
      const dbProvider = new DatabaseProvider(
        providerConfigs.database || {},
        { database: dependencies.database }
      );
      await dbProvider.initialize();
      this.registerProvider('database', dbProvider, providerConfigs.database?.priority || 10);
    }

    // Remote provider (future implementation)
    if (providerConfigs.remote?.enabled) {
      // TODO: Implement remote configuration provider
    }
  }

  registerProvider(name, provider, priority = 0) {
    this.providers.set(name, { provider, priority });
  }

  /**
   * Get configuration value
   * @param {string} key - Configuration key
   * @param {*} defaultValue - Default value if not found
   * @param {Object} options - Additional options
   */
  async get(key, defaultValue = undefined, options = {}) {
    // Check cache first
    const cacheKey = this.getCacheKey(key, options);
    if (this.cache.has(cacheKey) && !options.noCache) {
      return this.cache.get(cacheKey);
    }

    // Get from providers in priority order
    const sortedProviders = this.getSortedProviders();
    
    for (const { provider } of sortedProviders) {
      try {
        const value = await provider.get(key);
        if (value !== undefined) {
          // Validate if schema exists
          if (this.schemas.has(key)) {
            const validation = await this.validate(key, value);
            if (!validation.valid) {
              console.warn(`Configuration validation failed for ${key}:`, validation.error);
              continue;
            }
          }

          // Cache the value
          this.cache.set(cacheKey, value);
          
          return value;
        }
      } catch (error) {
        console.error(`Error getting ${key} from provider:`, error);
      }
    }

    // Return default value
    const configDefault = this.defaults.get(key);
    return configDefault !== undefined ? configDefault : defaultValue;
  }

  /**
   * Get multiple configuration values
   * @param {string[]} keys - Configuration keys
   * @param {Object} options - Additional options
   */
  async getMany(keys, options = {}) {
    const results = {};
    
    // Batch get from providers
    const sortedProviders = this.getSortedProviders();
    
    for (const { provider } of sortedProviders) {
      try {
        const values = await provider.getMany(keys);
        
        for (const [key, value] of Object.entries(values)) {
          if (!(key in results) && value !== undefined) {
            results[key] = value;
          }
        }
      } catch (error) {
        console.error('Error getting multiple values from provider:', error);
      }
    }

    // Add defaults for missing keys
    for (const key of keys) {
      if (!(key in results)) {
        const defaultValue = this.defaults.get(key);
        if (defaultValue !== undefined) {
          results[key] = defaultValue;
        }
      }
    }

    return results;
  }

  /**
   * Set configuration value
   * @param {string} key - Configuration key
   * @param {*} value - Configuration value
   * @param {Object} options - Additional options
   */
  async set(key, value, options = {}) {
    // Validate if schema exists
    if (this.schemas.has(key)) {
      const validation = await this.validate(key, value);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.error}`);
      }
    }

    // Determine target provider
    const targetProvider = options.provider || this.config.defaultWriteProvider || 'database';
    const providerEntry = this.providers.get(targetProvider);
    
    if (!providerEntry) {
      throw new Error(`Provider not found: ${targetProvider}`);
    }

    // Set value
    await providerEntry.provider.set(key, value, options);

    // Clear cache
    this.clearCache(key);

    // Emit change event
    this.emit('change', {
      key,
      value,
      oldValue: await this.get(key, undefined, { noCache: true }),
      source: targetProvider,
      timestamp: new Date()
    });

    return value;
  }

  /**
   * Set multiple configuration values
   * @param {Object} configs - Key-value pairs
   * @param {Object} options - Additional options
   */
  async setMany(configs, options = {}) {
    const results = [];
    
    for (const [key, value] of Object.entries(configs)) {
      try {
        await this.set(key, value, options);
        results.push({ key, success: true });
      } catch (error) {
        results.push({ key, success: false, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * Delete configuration value
   * @param {string} key - Configuration key
   * @param {Object} options - Additional options
   */
  async delete(key, options = {}) {
    const targetProvider = options.provider || this.config.defaultWriteProvider || 'database';
    const providerEntry = this.providers.get(targetProvider);
    
    if (!providerEntry) {
      throw new Error(`Provider not found: ${targetProvider}`);
    }

    // Get old value for event
    const oldValue = await this.get(key);

    // Delete value
    await providerEntry.provider.delete(key);

    // Clear cache
    this.clearCache(key);

    // Emit change event
    this.emit('change', {
      key,
      value: undefined,
      oldValue,
      source: targetProvider,
      timestamp: new Date()
    });
  }

  /**
   * Register configuration schema
   * @param {string} key - Configuration key
   * @param {Object} schema - Joi schema
   * @param {*} defaultValue - Default value
   */
  registerSchema(key, schema, defaultValue = undefined) {
    this.schemas.set(key, schema);
    
    if (defaultValue !== undefined) {
      this.defaults.set(key, defaultValue);
    }
  }

  /**
   * Register multiple schemas
   * @param {Object} schemas - Schema definitions
   */
  registerSchemas(schemas) {
    for (const [key, definition] of Object.entries(schemas)) {
      if (definition.schema) {
        this.registerSchema(key, definition.schema, definition.default);
      } else {
        this.registerSchema(key, definition);
      }
    }
  }

  /**
   * Validate configuration value
   * @param {string} key - Configuration key
   * @param {*} value - Value to validate
   */
  async validate(key, value) {
    const schema = this.schemas.get(key);
    
    if (!schema) {
      return { valid: true };
    }

    try {
      const validated = await schema.validateAsync(value);
      return { valid: true, value: validated };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Get all configurations matching a pattern
   * @param {string} pattern - Key pattern
   * @param {Object} options - Additional options
   */
  async getPattern(pattern, options = {}) {
    const allKeys = new Set();
    const sortedProviders = this.getSortedProviders();
    
    // Collect all matching keys from providers
    for (const { provider } of sortedProviders) {
      try {
        const keys = await provider.list(pattern);
        keys.forEach(key => allKeys.add(key));
      } catch (error) {
        console.error('Error listing keys from provider:', error);
      }
    }

    // Get values for all keys
    const results = {};
    for (const key of allKeys) {
      results[key] = await this.get(key, undefined, options);
    }

    return results;
  }

  /**
   * Watch for configuration changes
   * @param {string|string[]} keys - Keys to watch
   * @param {Function} callback - Callback function
   */
  watch(keys, callback) {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    
    const watcher = {
      keys: keyArray,
      callback,
      active: true
    };
    
    this.watchers.push(watcher);
    
    // Return unwatch function
    return () => {
      watcher.active = false;
      const index = this.watchers.indexOf(watcher);
      if (index > -1) {
        this.watchers.splice(index, 1);
      }
    };
  }

  /**
   * Handle configuration change from provider
   * @param {Object} change - Change event
   */
  handleConfigChange(change) {
    // Clear cache for changed key
    this.clearCache(change.key);

    // Notify watchers
    for (const watcher of this.watchers) {
      if (watcher.active && 
          (watcher.keys.includes('*') || watcher.keys.includes(change.key))) {
        try {
          watcher.callback(change);
        } catch (error) {
          console.error('Error in configuration watcher:', error);
        }
      }
    }

    // Emit change event
    this.emit('change', change);
  }

  // Feature flag methods
  async getFeatureFlag(key, context = {}) {
    if (!this.featureFlagService) {
      throw new Error('Feature flags not enabled');
    }
    
    return await this.featureFlagService.evaluate(key, context);
  }

  async getAllFeatureFlags(context = {}) {
    if (!this.featureFlagService) {
      throw new Error('Feature flags not enabled');
    }
    
    return await this.featureFlagService.evaluateAll(context);
  }

  async createFeatureFlag(flag) {
    if (!this.featureFlagService) {
      throw new Error('Feature flags not enabled');
    }
    
    return await this.featureFlagService.createFlag(flag);
  }

  async updateFeatureFlag(key, updates) {
    if (!this.featureFlagService) {
      throw new Error('Feature flags not enabled');
    }
    
    return await this.featureFlagService.updateFlag(key, updates);
  }

  async deleteFeatureFlag(key) {
    if (!this.featureFlagService) {
      throw new Error('Feature flags not enabled');
    }
    
    return await this.featureFlagService.deleteFlag(key);
  }

  async listFeatureFlags(options = {}) {
    if (!this.featureFlagService) {
      throw new Error('Feature flags not enabled');
    }
    
    return await this.featureFlagService.listFlags(options);
  }

  // Utility methods
  getSortedProviders() {
    return Array.from(this.providers.values())
      .sort((a, b) => b.priority - a.priority);
  }

  getCacheKey(key, options = {}) {
    const scope = options.scope || ConfigurationScope.GLOBAL;
    const scopeId = options.scopeId || '';
    return `${scope}:${scopeId}:${key}`;
  }

  clearCache(key = null) {
    if (key) {
      // Clear specific key and patterns
      for (const cacheKey of this.cache.keys()) {
        if (cacheKey.endsWith(`:${key}`)) {
          this.cache.delete(cacheKey);
        }
      }
    } else {
      // Clear all cache
      this.cache.clear();
    }
  }

  async preloadConfigurations() {
    if (!this.config.preload || this.config.preload.length === 0) {
      return;
    }

    const keys = this.config.preload;
    const values = await this.getMany(keys);
    
    // Cache preloaded values
    for (const [key, value] of Object.entries(values)) {
      this.cache.set(this.getCacheKey(key), value);
    }
  }

  async getMetrics() {
    const metrics = {
      providers: {},
      cache: {
        size: this.cache.size,
        keys: Array.from(this.cache.keys())
      },
      schemas: {
        count: this.schemas.size,
        keys: Array.from(this.schemas.keys())
      },
      watchers: {
        count: this.watchers.length,
        active: this.watchers.filter(w => w.active).length
      }
    };

    // Get provider metrics
    for (const [name, { provider }] of this.providers) {
      metrics.providers[name] = await provider.getMetrics();
    }

    // Get feature flag metrics if enabled
    if (this.featureFlagService) {
      metrics.featureFlags = {
        enabled: true
      };
    }

    return metrics;
  }

  async cleanup() {
    // Clean up providers
    for (const { provider } of this.providers.values()) {
      if (provider.cleanup) {
        await provider.cleanup();
      }
    }

    // Clear watchers
    this.watchers = [];

    // Clear cache
    this.cache.clear();

    // Remove all listeners
    this.removeAllListeners();
  }
}

module.exports = ConfigurationModule;