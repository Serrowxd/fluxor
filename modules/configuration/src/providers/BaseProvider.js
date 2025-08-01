const { ConfigurationSource } = require('../types');

class BaseProvider {
  constructor(config = {}) {
    this.config = config;
    this.source = ConfigurationSource.DEFAULT;
    this.priority = config.priority || 0;
    this.cache = new Map();
  }

  /**
   * Initialize the provider
   */
  async initialize() {
    // Override in subclasses
  }

  /**
   * Get configuration value
   * @param {string} key - Configuration key
   * @returns {Promise<*>} Configuration value
   */
  async get(key) {
    throw new Error('get() method must be implemented by provider');
  }

  /**
   * Get multiple configuration values
   * @param {string[]} keys - Configuration keys
   * @returns {Promise<Object>} Key-value pairs
   */
  async getMany(keys) {
    const results = {};
    
    for (const key of keys) {
      try {
        const value = await this.get(key);
        if (value !== undefined) {
          results[key] = value;
        }
      } catch (error) {
        // Skip errors for individual keys
        console.error(`Error getting key ${key}:`, error.message);
      }
    }
    
    return results;
  }

  /**
   * Set configuration value
   * @param {string} key - Configuration key
   * @param {*} value - Configuration value
   */
  async set(key, value) {
    throw new Error('set() method must be implemented by provider');
  }

  /**
   * Set multiple configuration values
   * @param {Object} configs - Key-value pairs
   */
  async setMany(configs) {
    const results = [];
    
    for (const [key, value] of Object.entries(configs)) {
      try {
        await this.set(key, value);
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
   */
  async delete(key) {
    throw new Error('delete() method must be implemented by provider');
  }

  /**
   * List all configuration keys
   * @param {string} [prefix] - Optional prefix filter
   * @returns {Promise<string[]>} List of keys
   */
  async list(prefix) {
    throw new Error('list() method must be implemented by provider');
  }

  /**
   * Check if configuration exists
   * @param {string} key - Configuration key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    try {
      const value = await this.get(key);
      return value !== undefined;
    } catch (error) {
      return false;
    }
  }

  /**
   * Watch for configuration changes
   * @param {Function} callback - Callback for changes
   */
  watch(callback) {
    // Override in providers that support watching
    console.warn(`Provider ${this.constructor.name} does not support watching`);
  }

  /**
   * Stop watching for changes
   */
  unwatch() {
    // Override in providers that support watching
  }

  /**
   * Clear provider cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get provider metrics
   * @returns {Promise<Object>}
   */
  async getMetrics() {
    return {
      source: this.source,
      priority: this.priority,
      cacheSize: this.cache.size
    };
  }

  /**
   * Validate configuration value
   * @param {string} key - Configuration key
   * @param {*} value - Value to validate
   * @returns {Object} Validation result
   */
  validate(key, value) {
    // Override in subclasses for validation
    return { valid: true };
  }

  /**
   * Transform value for storage
   * @param {*} value - Value to transform
   * @returns {*} Transformed value
   */
  transformForStorage(value) {
    // Handle different types
    if (value === null || value === undefined) {
      return value;
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    
    return String(value);
  }

  /**
   * Transform value from storage
   * @param {*} value - Stored value
   * @param {string} [type] - Expected type
   * @returns {*} Transformed value
   */
  transformFromStorage(value, type) {
    if (value === null || value === undefined) {
      return value;
    }
    
    // Try to parse JSON
    if (type === 'json' || type === 'object' || type === 'array') {
      try {
        return JSON.parse(value);
      } catch (error) {
        // Return as-is if not valid JSON
        return value;
      }
    }
    
    // Type conversions
    if (type === 'number') {
      return Number(value);
    }
    
    if (type === 'boolean') {
      return value === 'true' || value === true || value === 1 || value === '1';
    }
    
    return value;
  }

  /**
   * Parse dot notation key into segments
   * @param {string} key - Dot notation key
   * @returns {string[]} Key segments
   */
  parseKey(key) {
    return key.split('.');
  }

  /**
   * Get nested value from object
   * @param {Object} obj - Source object
   * @param {string} key - Dot notation key
   * @returns {*} Value
   */
  getNestedValue(obj, key) {
    const segments = this.parseKey(key);
    let current = obj;
    
    for (const segment of segments) {
      if (current && typeof current === 'object' && segment in current) {
        current = current[segment];
      } else {
        return undefined;
      }
    }
    
    return current;
  }

  /**
   * Set nested value in object
   * @param {Object} obj - Target object
   * @param {string} key - Dot notation key
   * @param {*} value - Value to set
   */
  setNestedValue(obj, key, value) {
    const segments = this.parseKey(key);
    const lastSegment = segments.pop();
    let current = obj;
    
    for (const segment of segments) {
      if (!(segment in current) || typeof current[segment] !== 'object') {
        current[segment] = {};
      }
      current = current[segment];
    }
    
    current[lastSegment] = value;
  }
}

module.exports = BaseProvider;