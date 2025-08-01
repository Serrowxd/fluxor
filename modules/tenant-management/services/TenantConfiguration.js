/**
 * Tenant Configuration - Tenant-specific configuration management
 * @module tenant-management/services/TenantConfiguration
 */

const EventEmitter = require('events');

class TenantConfiguration extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.configCache = new Map();
    this.schemas = new Map();
  }

  /**
   * Register configuration schema
   * @param {string} namespace - Configuration namespace
   * @param {Object} schema - JSON schema for validation
   */
  registerSchema(namespace, schema) {
    this.schemas.set(namespace, schema);
  }

  /**
   * Get tenant configuration
   * @param {string} tenantId - Tenant ID
   * @param {string} namespace - Configuration namespace (optional)
   * @returns {Promise<Object>} Configuration
   */
  async getConfiguration(tenantId, namespace) {
    const cacheKey = `${tenantId}:${namespace || 'all'}`;
    
    // Check cache
    if (this.configCache.has(cacheKey)) {
      const cached = this.configCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 300000) { // 5 minute cache
        return cached.config;
      }
    }

    const config = await this._loadConfiguration(tenantId, namespace);
    
    // Cache result
    this.configCache.set(cacheKey, {
      config,
      timestamp: Date.now()
    });

    return config;
  }

  /**
   * Set tenant configuration
   * @param {string} tenantId - Tenant ID
   * @param {string} namespace - Configuration namespace
   * @param {Object} config - Configuration object
   * @returns {Promise<Object>} Updated configuration
   */
  async setConfiguration(tenantId, namespace, config) {
    // Validate against schema if available
    if (this.schemas.has(namespace)) {
      const schema = this.schemas.get(namespace);
      const validation = this._validateConfiguration(config, schema);
      if (!validation.valid) {
        throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
      }
    }

    // Save configuration
    await this._saveConfiguration(tenantId, namespace, config);
    
    // Clear cache
    this._clearConfigCache(tenantId, namespace);
    
    // Emit update event
    this.emit('configuration.updated', {
      tenantId,
      namespace,
      config
    });

    return config;
  }

  /**
   * Update specific configuration values
   * @param {string} tenantId - Tenant ID
   * @param {string} namespace - Configuration namespace
   * @param {Object} updates - Configuration updates
   * @returns {Promise<Object>} Updated configuration
   */
  async updateConfiguration(tenantId, namespace, updates) {
    const currentConfig = await this.getConfiguration(tenantId, namespace) || {};
    const mergedConfig = this._deepMerge(currentConfig, updates);
    
    return await this.setConfiguration(tenantId, namespace, mergedConfig);
  }

  /**
   * Delete tenant configuration
   * @param {string} tenantId - Tenant ID
   * @param {string} namespace - Configuration namespace
   * @returns {Promise<boolean>} Success
   */
  async deleteConfiguration(tenantId, namespace) {
    await this._deleteConfiguration(tenantId, namespace);
    this._clearConfigCache(tenantId, namespace);
    
    this.emit('configuration.deleted', {
      tenantId,
      namespace
    });

    return true;
  }

  /**
   * Get configuration value by path
   * @param {string} tenantId - Tenant ID
   * @param {string} path - Dot-notation path (e.g., 'features.analytics.enabled')
   * @param {any} defaultValue - Default value if not found
   * @returns {Promise<any>} Configuration value
   */
  async getValue(tenantId, path, defaultValue = null) {
    const parts = path.split('.');
    const namespace = parts[0];
    const config = await this.getConfiguration(tenantId, namespace);
    
    return this._getValueByPath(config, parts.slice(1), defaultValue);
  }

  /**
   * Set configuration value by path
   * @param {string} tenantId - Tenant ID
   * @param {string} path - Dot-notation path
   * @param {any} value - Value to set
   * @returns {Promise<Object>} Updated configuration
   */
  async setValue(tenantId, path, value) {
    const parts = path.split('.');
    const namespace = parts[0];
    const currentConfig = await this.getConfiguration(tenantId, namespace) || {};
    
    const updatedConfig = this._setValueByPath(
      { ...currentConfig },
      parts.slice(1),
      value
    );
    
    return await this.setConfiguration(tenantId, namespace, updatedConfig);
  }

  /**
   * Apply configuration template
   * @param {string} tenantId - Tenant ID
   * @param {string} templateName - Template name
   * @param {Object} variables - Template variables
   * @returns {Promise<Object>} Applied configuration
   */
  async applyTemplate(tenantId, templateName, variables = {}) {
    const template = await this._loadTemplate(templateName);
    if (!template) {
      throw new Error(`Template '${templateName}' not found`);
    }

    const config = this._processTemplate(template, variables);
    const results = {};

    // Apply configuration for each namespace in template
    for (const [namespace, namespaceConfig] of Object.entries(config)) {
      results[namespace] = await this.setConfiguration(
        tenantId,
        namespace,
        namespaceConfig
      );
    }

    return results;
  }

  /**
   * Export tenant configuration
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} All configuration
   */
  async exportConfiguration(tenantId) {
    const allConfig = await this._loadConfiguration(tenantId);
    
    return {
      tenantId,
      exportedAt: new Date(),
      configuration: allConfig
    };
  }

  /**
   * Import tenant configuration
   * @param {string} tenantId - Tenant ID
   * @param {Object} configData - Configuration data
   * @returns {Promise<Object>} Import result
   */
  async importConfiguration(tenantId, configData) {
    const results = {
      success: [],
      errors: []
    };

    for (const [namespace, config] of Object.entries(configData.configuration || {})) {
      try {
        await this.setConfiguration(tenantId, namespace, config);
        results.success.push(namespace);
      } catch (error) {
        results.errors.push({
          namespace,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Get configuration diff
   * @param {string} tenantId1 - First tenant ID
   * @param {string} tenantId2 - Second tenant ID
   * @returns {Promise<Object>} Configuration differences
   */
  async getConfigurationDiff(tenantId1, tenantId2) {
    const config1 = await this._loadConfiguration(tenantId1);
    const config2 = await this._loadConfiguration(tenantId2);
    
    return this._calculateDiff(config1, config2);
  }

  /**
   * Validate configuration against schema
   * @private
   */
  _validateConfiguration(config, schema) {
    // Simple validation implementation
    // In production, would use a JSON schema validator
    const errors = [];
    
    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in config)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Deep merge objects
   * @private
   */
  _deepMerge(target, source) {
    const output = { ...target };
    
    for (const key in source) {
      if (source[key] instanceof Object && key in target) {
        output[key] = this._deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
    
    return output;
  }

  /**
   * Get value by path
   * @private
   */
  _getValueByPath(obj, path, defaultValue) {
    let current = obj;
    
    for (const part of path) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return defaultValue;
      }
    }
    
    return current;
  }

  /**
   * Set value by path
   * @private
   */
  _setValueByPath(obj, path, value) {
    let current = obj;
    
    for (let i = 0; i < path.length - 1; i++) {
      const part = path[i];
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part];
    }
    
    current[path[path.length - 1]] = value;
    return obj;
  }

  /**
   * Process template with variables
   * @private
   */
  _processTemplate(template, variables) {
    const processed = JSON.stringify(template);
    const result = processed.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] || match;
    });
    
    return JSON.parse(result);
  }

  /**
   * Calculate configuration diff
   * @private
   */
  _calculateDiff(config1, config2) {
    const diff = {
      added: {},
      removed: {},
      modified: {}
    };
    
    // Find added and modified
    for (const [key, value] of Object.entries(config2)) {
      if (!(key in config1)) {
        diff.added[key] = value;
      } else if (JSON.stringify(config1[key]) !== JSON.stringify(value)) {
        diff.modified[key] = {
          old: config1[key],
          new: value
        };
      }
    }
    
    // Find removed
    for (const key of Object.keys(config1)) {
      if (!(key in config2)) {
        diff.removed[key] = config1[key];
      }
    }
    
    return diff;
  }

  /**
   * Clear configuration cache
   * @private
   */
  _clearConfigCache(tenantId, namespace) {
    if (namespace) {
      this.configCache.delete(`${tenantId}:${namespace}`);
    } else {
      // Clear all cache entries for tenant
      for (const key of this.configCache.keys()) {
        if (key.startsWith(`${tenantId}:`)) {
          this.configCache.delete(key);
        }
      }
    }
    
    // Always clear the 'all' cache
    this.configCache.delete(`${tenantId}:all`);
  }

  /**
   * Database operations (to be implemented)
   */
  async _loadConfiguration(tenantId, namespace) {
    // Database load implementation
    return {};
  }

  async _saveConfiguration(tenantId, namespace, config) {
    // Database save implementation
  }

  async _deleteConfiguration(tenantId, namespace) {
    // Database delete implementation
  }

  async _loadTemplate(templateName) {
    // Template load implementation
    return null;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.configCache.clear();
    this.schemas.clear();
    this.removeAllListeners();
  }
}

module.exports = TenantConfiguration;