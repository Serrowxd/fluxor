const fs = require('fs').promises;
const path = require('path');
const chokidar = require('chokidar');
const yaml = require('yaml');
const BaseProvider = require('./BaseProvider');
const { ConfigurationSource } = require('../types');

class FileProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.source = ConfigurationSource.FILE;
    this.filePath = config.filePath || 'config.json';
    this.format = config.format || this.detectFormat(this.filePath);
    this.watch = config.watch !== false;
    this.watcher = null;
    this.data = {};
    this.callbacks = [];
  }

  async initialize() {
    // Load initial data
    await this.load();

    // Set up file watching
    if (this.watch) {
      this.setupWatcher();
    }
  }

  async load() {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      this.data = await this.parse(content);
      this.cache.clear(); // Clear cache on reload
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create with empty data
        this.data = {};
        await this.save();
      } else {
        throw error;
      }
    }
  }

  async save() {
    const content = await this.stringify(this.data);
    const dir = path.dirname(this.filePath);
    
    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });
    
    // Write atomically
    const tempFile = `${this.filePath}.tmp`;
    await fs.writeFile(tempFile, content, 'utf8');
    await fs.rename(tempFile, this.filePath);
  }

  async parse(content) {
    switch (this.format) {
      case 'json':
        return JSON.parse(content);
        
      case 'yaml':
      case 'yml':
        return yaml.parse(content);
        
      case 'properties':
        return this.parseProperties(content);
        
      case 'ini':
        return this.parseIni(content);
        
      default:
        throw new Error(`Unsupported format: ${this.format}`);
    }
  }

  async stringify(data) {
    switch (this.format) {
      case 'json':
        return JSON.stringify(data, null, 2);
        
      case 'yaml':
      case 'yml':
        return yaml.stringify(data);
        
      case 'properties':
        return this.stringifyProperties(data);
        
      case 'ini':
        return this.stringifyIni(data);
        
      default:
        throw new Error(`Unsupported format: ${this.format}`);
    }
  }

  async get(key) {
    // Check cache first
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const value = this.getNestedValue(this.data, key);
    
    // Cache the result
    if (value !== undefined) {
      this.cache.set(key, value);
    }
    
    return value;
  }

  async set(key, value) {
    this.setNestedValue(this.data, key, value);
    this.cache.set(key, value);
    
    // Save to file
    await this.save();
    
    // Notify watchers
    this.notifyChange(key, value);
  }

  async delete(key) {
    const segments = this.parseKey(key);
    const lastSegment = segments.pop();
    let current = this.data;
    
    // Navigate to parent
    for (const segment of segments) {
      if (current && typeof current === 'object' && segment in current) {
        current = current[segment];
      } else {
        return; // Key doesn't exist
      }
    }
    
    // Delete the key
    if (current && typeof current === 'object' && lastSegment in current) {
      delete current[lastSegment];
      this.cache.delete(key);
      
      // Save to file
      await this.save();
      
      // Notify watchers
      this.notifyChange(key, undefined);
    }
  }

  async list(prefix) {
    const keys = [];
    
    const traverse = (obj, path = '') => {
      for (const key in obj) {
        const fullKey = path ? `${path}.${key}` : key;
        
        if (!prefix || fullKey.startsWith(prefix)) {
          keys.push(fullKey);
        }
        
        if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          traverse(obj[key], fullKey);
        }
      }
    };
    
    traverse(this.data);
    return keys;
  }

  setupWatcher() {
    this.watcher = chokidar.watch(this.filePath, {
      persistent: true,
      ignoreInitial: true
    });
    
    this.watcher.on('change', async () => {
      console.log(`Configuration file changed: ${this.filePath}`);
      
      try {
        const oldData = { ...this.data };
        await this.load();
        
        // Detect changes
        const changes = this.detectChanges(oldData, this.data);
        
        // Notify about each change
        for (const change of changes) {
          this.notifyChange(change.key, change.newValue, change.oldValue);
        }
      } catch (error) {
        console.error('Error reloading configuration:', error);
      }
    });
  }

  detectChanges(oldData, newData, path = '') {
    const changes = [];
    const allKeys = new Set([
      ...Object.keys(oldData),
      ...Object.keys(newData)
    ]);
    
    for (const key of allKeys) {
      const fullKey = path ? `${path}.${key}` : key;
      const oldValue = oldData[key];
      const newValue = newData[key];
      
      if (oldValue !== newValue) {
        if (typeof oldValue === 'object' && typeof newValue === 'object' && 
            oldValue !== null && newValue !== null &&
            !Array.isArray(oldValue) && !Array.isArray(newValue)) {
          // Recurse into objects
          changes.push(...this.detectChanges(oldValue, newValue, fullKey));
        } else {
          changes.push({
            key: fullKey,
            oldValue,
            newValue
          });
        }
      }
    }
    
    return changes;
  }

  watch(callback) {
    this.callbacks.push(callback);
  }

  unwatch(callback) {
    const index = this.callbacks.indexOf(callback);
    if (index > -1) {
      this.callbacks.splice(index, 1);
    }
  }

  notifyChange(key, newValue, oldValue) {
    for (const callback of this.callbacks) {
      try {
        callback({
          key,
          newValue,
          oldValue,
          source: this.source,
          timestamp: new Date()
        });
      } catch (error) {
        console.error('Error in configuration change callback:', error);
      }
    }
  }

  detectFormat(filePath) {
    const ext = path.extname(filePath).toLowerCase().substring(1);
    return ext || 'json';
  }

  parseProperties(content) {
    const properties = {};
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
        continue;
      }
      
      const index = trimmed.indexOf('=');
      if (index > 0) {
        const key = trimmed.substring(0, index).trim();
        const value = trimmed.substring(index + 1).trim();
        this.setNestedValue(properties, key, this.parseValue(value));
      }
    }
    
    return properties;
  }

  stringifyProperties(data) {
    const lines = [];
    
    const flatten = (obj, prefix = '') => {
      for (const key in obj) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const value = obj[key];
        
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          flatten(value, fullKey);
        } else {
          lines.push(`${fullKey}=${this.transformForStorage(value)}`);
        }
      }
    };
    
    flatten(data);
    return lines.join('\n');
  }

  parseIni(content) {
    const ini = {};
    const lines = content.split('\n');
    let currentSection = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) {
        continue;
      }
      
      // Section header
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentSection = trimmed.substring(1, trimmed.length - 1);
        ini[currentSection] = {};
        continue;
      }
      
      // Key-value pair
      const index = trimmed.indexOf('=');
      if (index > 0) {
        const key = trimmed.substring(0, index).trim();
        const value = trimmed.substring(index + 1).trim();
        
        if (currentSection) {
          ini[currentSection][key] = this.parseValue(value);
        } else {
          ini[key] = this.parseValue(value);
        }
      }
    }
    
    return ini;
  }

  stringifyIni(data) {
    const lines = [];
    
    // Global properties
    for (const key in data) {
      const value = data[key];
      if (typeof value !== 'object' || Array.isArray(value)) {
        lines.push(`${key}=${this.transformForStorage(value)}`);
      }
    }
    
    // Sections
    for (const key in data) {
      const value = data[key];
      if (typeof value === 'object' && !Array.isArray(value)) {
        if (lines.length > 0) lines.push('');
        lines.push(`[${key}]`);
        
        for (const subKey in value) {
          lines.push(`${subKey}=${this.transformForStorage(value[subKey])}`);
        }
      }
    }
    
    return lines.join('\n');
  }

  async cleanup() {
    if (this.watcher) {
      await this.watcher.close();
    }
  }

  async getMetrics() {
    const base = await super.getMetrics();
    const stats = await fs.stat(this.filePath);
    
    return {
      ...base,
      filePath: this.filePath,
      format: this.format,
      fileSize: stats.size,
      lastModified: stats.mtime,
      watching: this.watch && this.watcher !== null
    };
  }
}

module.exports = FileProvider;