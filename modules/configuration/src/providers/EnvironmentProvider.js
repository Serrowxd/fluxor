const BaseProvider = require('./BaseProvider');
const { ConfigurationSource } = require('../types');

class EnvironmentProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.source = ConfigurationSource.ENVIRONMENT;
    this.prefix = config.prefix || 'FLUXOR_';
    this.delimiter = config.delimiter || '__';
    this.includeSystemEnv = config.includeSystemEnv !== false;
  }

  async initialize() {
    // Load .env file if specified
    if (this.config.envFile) {
      const dotenv = require('dotenv');
      const path = require('path');
      
      dotenv.config({
        path: path.resolve(this.config.envFile)
      });
    }
  }

  async get(key) {
    // Convert dot notation to environment variable format
    const envKey = this.toEnvKey(key);
    
    // Check with prefix first
    let value = process.env[this.prefix + envKey];
    
    // Check without prefix if includeSystemEnv is true
    if (value === undefined && this.includeSystemEnv) {
      value = process.env[envKey];
    }
    
    if (value === undefined) {
      return undefined;
    }
    
    // Auto-detect and parse value type
    return this.parseValue(value);
  }

  async set(key, value) {
    const envKey = this.toEnvKey(key);
    process.env[this.prefix + envKey] = this.transformForStorage(value);
  }

  async delete(key) {
    const envKey = this.toEnvKey(key);
    delete process.env[this.prefix + envKey];
    
    if (this.includeSystemEnv) {
      delete process.env[envKey];
    }
  }

  async list(prefix) {
    const keys = new Set();
    const envPrefix = prefix ? this.toEnvKey(prefix) : '';
    
    for (const envKey of Object.keys(process.env)) {
      // Check prefixed keys
      if (envKey.startsWith(this.prefix)) {
        const key = envKey.substring(this.prefix.length);
        if (!envPrefix || key.startsWith(envPrefix)) {
          keys.add(this.fromEnvKey(key));
        }
      }
      
      // Check unprefixed keys if includeSystemEnv
      if (this.includeSystemEnv && (!envPrefix || envKey.startsWith(envPrefix))) {
        keys.add(this.fromEnvKey(envKey));
      }
    }
    
    return Array.from(keys);
  }

  /**
   * Convert dot notation to environment variable format
   * @param {string} key - Dot notation key (e.g., 'database.host')
   * @returns {string} Environment key (e.g., 'DATABASE__HOST')
   */
  toEnvKey(key) {
    return key
      .toUpperCase()
      .replace(/\./g, this.delimiter)
      .replace(/-/g, '_');
  }

  /**
   * Convert environment variable format to dot notation
   * @param {string} envKey - Environment key
   * @returns {string} Dot notation key
   */
  fromEnvKey(envKey) {
    return envKey
      .toLowerCase()
      .replace(new RegExp(this.delimiter, 'g'), '.')
      .replace(/_/g, '-');
  }

  /**
   * Parse environment variable value
   * @param {string} value - Raw string value
   * @returns {*} Parsed value
   */
  parseValue(value) {
    // Handle empty values
    if (value === '') {
      return '';
    }
    
    // Boolean values
    if (value.toLowerCase() === 'true') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }
    
    // Null values
    if (value.toLowerCase() === 'null') {
      return null;
    }
    
    // Number values
    if (/^-?\d+$/.test(value)) {
      return parseInt(value, 10);
    }
    if (/^-?\d*\.\d+$/.test(value)) {
      return parseFloat(value);
    }
    
    // JSON values
    if ((value.startsWith('{') && value.endsWith('}')) ||
        (value.startsWith('[') && value.endsWith(']'))) {
      try {
        return JSON.parse(value);
      } catch (error) {
        // Not valid JSON, return as string
      }
    }
    
    // Comma-separated arrays
    if (this.config.parseArrays && value.includes(',')) {
      return value.split(',').map(item => item.trim());
    }
    
    // Default to string
    return value;
  }

  /**
   * Get all environment configurations
   * @returns {Object} All configurations
   */
  async getAll() {
    const configs = {};
    const keys = await this.list();
    
    for (const key of keys) {
      const value = await this.get(key);
      if (value !== undefined) {
        this.setNestedValue(configs, key, value);
      }
    }
    
    return configs;
  }

  /**
   * Export current environment to .env format
   * @returns {string} .env file content
   */
  async export() {
    const lines = [];
    const keys = await this.list();
    
    for (const key of keys) {
      const value = await this.get(key);
      const envKey = this.prefix + this.toEnvKey(key);
      const envValue = this.transformForStorage(value);
      
      // Add quotes if value contains spaces or special characters
      const quotedValue = /[\s"'`$]/.test(envValue) ? `"${envValue}"` : envValue;
      lines.push(`${envKey}=${quotedValue}`);
    }
    
    return lines.join('\n');
  }

  async getMetrics() {
    const base = await super.getMetrics();
    const keys = await this.list();
    
    return {
      ...base,
      prefix: this.prefix,
      delimiter: this.delimiter,
      totalKeys: keys.length,
      includeSystemEnv: this.includeSystemEnv
    };
  }
}

module.exports = EnvironmentProvider;