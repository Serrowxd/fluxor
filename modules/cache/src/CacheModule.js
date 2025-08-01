const redis = require('redis');
const { promisify } = require('util');

class CacheModule {
  constructor(options = {}) {
    this.options = {
      host: options.host || process.env.REDIS_HOST || 'localhost',
      port: options.port || process.env.REDIS_PORT || 6379,
      password: options.password || process.env.REDIS_PASSWORD,
      db: options.db || process.env.REDIS_DB || 0,
      keyPrefix: options.keyPrefix || 'fluxor:',
      defaultTTL: options.defaultTTL || 3600,
      enableCluster: options.enableCluster || false,
      ...options
    };

    this.client = null;
    this.isConnected = false;
    this.keyPatterns = new Map();
    this.invalidationStrategies = new Map();
  }

  async initialize() {
    try {
      if (this.options.enableCluster) {
        this.client = redis.createCluster({
          rootNodes: this.options.clusterNodes || [
            { host: this.options.host, port: this.options.port }
          ],
          defaults: {
            password: this.options.password
          }
        });
      } else {
        this.client = redis.createClient({
          host: this.options.host,
          port: this.options.port,
          password: this.options.password,
          db: this.options.db
        });
      }

      this.client.on('error', (error) => {
        console.error('Cache connection error:', error);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('Cache connected successfully');
        this.isConnected = true;
      });

      await this.client.connect();

      this._setupCommands();
      this._registerDefaultPatterns();
      this._registerDefaultStrategies();

      return this;
    } catch (error) {
      console.error('Failed to initialize cache module:', error);
      throw error;
    }
  }

  _setupCommands() {
    this.getAsync = promisify(this.client.get).bind(this.client);
    this.setAsync = promisify(this.client.set).bind(this.client);
    this.delAsync = promisify(this.client.del).bind(this.client);
    this.existsAsync = promisify(this.client.exists).bind(this.client);
    this.expireAsync = promisify(this.client.expire).bind(this.client);
    this.ttlAsync = promisify(this.client.ttl).bind(this.client);
    this.keysAsync = promisify(this.client.keys).bind(this.client);
    this.mgetAsync = promisify(this.client.mget).bind(this.client);
    this.msetAsync = promisify(this.client.mset).bind(this.client);
    this.incrAsync = promisify(this.client.incr).bind(this.client);
    this.decrAsync = promisify(this.client.decr).bind(this.client);
    this.hgetAsync = promisify(this.client.hget).bind(this.client);
    this.hsetAsync = promisify(this.client.hset).bind(this.client);
    this.hgetallAsync = promisify(this.client.hgetall).bind(this.client);
    this.scanAsync = promisify(this.client.scan).bind(this.client);
  }

  _registerDefaultPatterns() {
    this.registerKeyPattern('user', (userId) => `user:${userId}`);
    this.registerKeyPattern('inventory', (productId) => `inventory:${productId}`);
    this.registerKeyPattern('order', (orderId) => `order:${orderId}`);
    this.registerKeyPattern('session', (sessionId) => `session:${sessionId}`);
    this.registerKeyPattern('analytics', (metric, date) => `analytics:${metric}:${date}`);
    this.registerKeyPattern('forecast', (productId, date) => `forecast:${productId}:${date}`);
    this.registerKeyPattern('channel', (channelId, resource) => `channel:${channelId}:${resource}`);
  }

  _registerDefaultStrategies() {
    this.registerInvalidationStrategy('cascade', async (key) => {
      const pattern = `${key}:*`;
      const keys = await this.keysAsync(this._buildKey(pattern));
      if (keys.length > 0) {
        await this.delAsync(keys);
      }
    });

    this.registerInvalidationStrategy('tag', async (tag) => {
      const tagKey = this._buildKey(`tags:${tag}`);
      const members = await this.client.smembers(tagKey);
      if (members.length > 0) {
        await this.delAsync(members);
        await this.client.del(tagKey);
      }
    });

    this.registerInvalidationStrategy('pattern', async (pattern) => {
      const keys = await this.keysAsync(this._buildKey(pattern));
      if (keys.length > 0) {
        await this.delAsync(keys);
      }
    });
  }

  registerKeyPattern(name, pattern) {
    this.keyPatterns.set(name, pattern);
  }

  registerInvalidationStrategy(name, strategy) {
    this.invalidationStrategies.set(name, strategy);
  }

  _buildKey(key) {
    return `${this.options.keyPrefix}${key}`;
  }

  _parseKey(key) {
    return key.startsWith(this.options.keyPrefix)
      ? key.slice(this.options.keyPrefix.length)
      : key;
  }

  async get(key, options = {}) {
    try {
      const fullKey = this._buildKey(key);
      const value = await this.client.get(fullKey);
      
      if (!value) return null;

      if (options.parse !== false) {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }

      return value;
    } catch (error) {
      console.error('Cache get error:', error);
      if (options.fallback) {
        return typeof options.fallback === 'function'
          ? await options.fallback()
          : options.fallback;
      }
      throw error;
    }
  }

  async set(key, value, options = {}) {
    try {
      const fullKey = this._buildKey(key);
      const ttl = options.ttl || this.options.defaultTTL;
      const serialized = options.stringify !== false
        ? JSON.stringify(value)
        : value;

      const args = [fullKey, serialized];
      if (ttl > 0) {
        args.push('EX', ttl);
      }

      await this.client.set(...args);

      if (options.tags) {
        await this._addTags(fullKey, options.tags);
      }

      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      throw error;
    }
  }

  async del(key) {
    try {
      const fullKey = this._buildKey(key);
      const result = await this.client.del(fullKey);
      return result > 0;
    } catch (error) {
      console.error('Cache delete error:', error);
      throw error;
    }
  }

  async exists(key) {
    try {
      const fullKey = this._buildKey(key);
      const result = await this.client.exists(fullKey);
      return result === 1;
    } catch (error) {
      console.error('Cache exists error:', error);
      throw error;
    }
  }

  async expire(key, ttl) {
    try {
      const fullKey = this._buildKey(key);
      const result = await this.client.expire(fullKey, ttl);
      return result === 1;
    } catch (error) {
      console.error('Cache expire error:', error);
      throw error;
    }
  }

  async ttl(key) {
    try {
      const fullKey = this._buildKey(key);
      return await this.client.ttl(fullKey);
    } catch (error) {
      console.error('Cache ttl error:', error);
      throw error;
    }
  }

  async mget(keys) {
    try {
      const fullKeys = keys.map(key => this._buildKey(key));
      const values = await this.client.mGet(fullKeys);
      
      return values.map((value, index) => {
        if (!value) return null;
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      });
    } catch (error) {
      console.error('Cache mget error:', error);
      throw error;
    }
  }

  async mset(keyValuePairs, options = {}) {
    try {
      const ttl = options.ttl || this.options.defaultTTL;
      const pipeline = this.client.multi();

      Object.entries(keyValuePairs).forEach(([key, value]) => {
        const fullKey = this._buildKey(key);
        const serialized = JSON.stringify(value);
        
        if (ttl > 0) {
          pipeline.set(fullKey, serialized, 'EX', ttl);
        } else {
          pipeline.set(fullKey, serialized);
        }
      });

      await pipeline.exec();
      return true;
    } catch (error) {
      console.error('Cache mset error:', error);
      throw error;
    }
  }

  async invalidate(strategy, ...args) {
    try {
      const invalidationFn = this.invalidationStrategies.get(strategy);
      if (!invalidationFn) {
        throw new Error(`Unknown invalidation strategy: ${strategy}`);
      }

      await invalidationFn(...args);
      return true;
    } catch (error) {
      console.error('Cache invalidation error:', error);
      throw error;
    }
  }

  async warmCache(warmer, options = {}) {
    try {
      const data = await warmer();
      const ttl = options.ttl || this.options.defaultTTL;
      const batchSize = options.batchSize || 100;

      if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i += batchSize) {
          const batch = data.slice(i, i + batchSize);
          const keyValuePairs = {};
          
          batch.forEach(item => {
            const key = options.keyExtractor
              ? options.keyExtractor(item)
              : item.id;
            keyValuePairs[key] = item;
          });

          await this.mset(keyValuePairs, { ttl });
        }
      } else {
        await this.mset(data, { ttl });
      }

      return true;
    } catch (error) {
      console.error('Cache warming error:', error);
      throw error;
    }
  }

  async lock(key, options = {}) {
    const lockKey = `${key}:lock`;
    const token = options.token || Date.now().toString();
    const ttl = options.ttl || 30;
    const retries = options.retries || 10;
    const retryDelay = options.retryDelay || 100;

    for (let i = 0; i < retries; i++) {
      const result = await this.client.set(
        this._buildKey(lockKey),
        token,
        'NX',
        'EX',
        ttl
      );

      if (result === 'OK') {
        return {
          token,
          release: async () => {
            const script = `
              if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
              else
                return 0
              end
            `;
            return await this.client.eval(
              script,
              1,
              this._buildKey(lockKey),
              token
            );
          }
        };
      }

      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }

    throw new Error(`Failed to acquire lock for key: ${key}`);
  }

  async _addTags(key, tags) {
    const pipeline = this.client.multi();
    
    tags.forEach(tag => {
      const tagKey = this._buildKey(`tags:${tag}`);
      pipeline.sadd(tagKey, key);
    });

    await pipeline.exec();
  }

  generateKey(pattern, ...args) {
    const patternFn = this.keyPatterns.get(pattern);
    if (!patternFn) {
      throw new Error(`Unknown key pattern: ${pattern}`);
    }
    return patternFn(...args);
  }

  async getStats() {
    try {
      const info = await this.client.info('stats');
      const memory = await this.client.info('memory');
      
      return {
        connections: this._parseInfo(info, 'connected_clients'),
        commands: this._parseInfo(info, 'total_commands_processed'),
        hits: this._parseInfo(info, 'keyspace_hits'),
        misses: this._parseInfo(info, 'keyspace_misses'),
        memory: {
          used: this._parseInfo(memory, 'used_memory'),
          peak: this._parseInfo(memory, 'used_memory_peak'),
          rss: this._parseInfo(memory, 'used_memory_rss')
        }
      };
    } catch (error) {
      console.error('Failed to get cache stats:', error);
      return null;
    }
  }

  _parseInfo(info, key) {
    const match = info.match(new RegExp(`${key}:(\\d+)`));
    return match ? parseInt(match[1], 10) : 0;
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
    }
  }
}

module.exports = CacheModule;