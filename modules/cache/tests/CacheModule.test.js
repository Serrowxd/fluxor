const CacheModule = require('../src/CacheModule');
const redis = require('redis-mock');

jest.mock('redis', () => require('redis-mock'));

describe('CacheModule', () => {
  let cache;

  beforeEach(async () => {
    cache = new CacheModule({
      host: 'localhost',
      port: 6379,
      keyPrefix: 'test:',
      defaultTTL: 60
    });
    await cache.initialize();
  });

  afterEach(async () => {
    if (cache) {
      await cache.disconnect();
    }
  });

  describe('Basic Operations', () => {
    test('should set and get values', async () => {
      await cache.set('testKey', { data: 'testValue' });
      const result = await cache.get('testKey');
      expect(result).toEqual({ data: 'testValue' });
    });

    test('should handle string values', async () => {
      await cache.set('stringKey', 'stringValue', { stringify: false });
      const result = await cache.get('stringKey', { parse: false });
      expect(result).toBe('stringValue');
    });

    test('should delete keys', async () => {
      await cache.set('deleteKey', 'value');
      const deleted = await cache.del('deleteKey');
      expect(deleted).toBe(true);
      
      const result = await cache.get('deleteKey');
      expect(result).toBeNull();
    });

    test('should check key existence', async () => {
      await cache.set('existsKey', 'value');
      
      const exists = await cache.exists('existsKey');
      expect(exists).toBe(true);
      
      const notExists = await cache.exists('nonExistentKey');
      expect(notExists).toBe(false);
    });

    test('should handle TTL', async () => {
      await cache.set('ttlKey', 'value', { ttl: 100 });
      const ttl = await cache.ttl('ttlKey');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(100);
    });

    test('should expire keys', async () => {
      await cache.set('expireKey', 'value');
      const expired = await cache.expire('expireKey', 10);
      expect(expired).toBe(true);
      
      const ttl = await cache.ttl('expireKey');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);
    });
  });

  describe('Batch Operations', () => {
    test('should handle mget', async () => {
      await cache.set('key1', { value: 1 });
      await cache.set('key2', { value: 2 });
      await cache.set('key3', { value: 3 });

      const results = await cache.mget(['key1', 'key2', 'key3', 'nonExistent']);
      expect(results).toEqual([
        { value: 1 },
        { value: 2 },
        { value: 3 },
        null
      ]);
    });

    test('should handle mset', async () => {
      await cache.mset({
        batch1: { data: 'value1' },
        batch2: { data: 'value2' },
        batch3: { data: 'value3' }
      });

      const result1 = await cache.get('batch1');
      const result2 = await cache.get('batch2');
      const result3 = await cache.get('batch3');

      expect(result1).toEqual({ data: 'value1' });
      expect(result2).toEqual({ data: 'value2' });
      expect(result3).toEqual({ data: 'value3' });
    });
  });

  describe('Key Patterns', () => {
    test('should generate keys using patterns', () => {
      const userKey = cache.generateKey('user', '123');
      expect(userKey).toBe('user:123');

      const inventoryKey = cache.generateKey('inventory', 'prod-456');
      expect(inventoryKey).toBe('inventory:prod-456');

      const analyticsKey = cache.generateKey('analytics', 'sales', '2024-01-15');
      expect(analyticsKey).toBe('analytics:sales:2024-01-15');
    });

    test('should register custom key patterns', () => {
      cache.registerKeyPattern('custom', (id, type) => `custom:${type}:${id}`);
      const customKey = cache.generateKey('custom', '789', 'special');
      expect(customKey).toBe('custom:special:789');
    });

    test('should throw error for unknown pattern', () => {
      expect(() => cache.generateKey('unknown', '123')).toThrow('Unknown key pattern: unknown');
    });
  });

  describe('Cache Warming', () => {
    test('should warm cache with array data', async () => {
      const data = [
        { id: 'prod1', name: 'Product 1' },
        { id: 'prod2', name: 'Product 2' },
        { id: 'prod3', name: 'Product 3' }
      ];

      await cache.warmCache(async () => data, {
        keyExtractor: item => `product:${item.id}`
      });

      const result1 = await cache.get('product:prod1');
      const result2 = await cache.get('product:prod2');
      const result3 = await cache.get('product:prod3');

      expect(result1).toEqual({ id: 'prod1', name: 'Product 1' });
      expect(result2).toEqual({ id: 'prod2', name: 'Product 2' });
      expect(result3).toEqual({ id: 'prod3', name: 'Product 3' });
    });

    test('should warm cache with object data', async () => {
      const data = {
        'config:app': { version: '1.0.0' },
        'config:api': { endpoint: 'https://api.example.com' }
      };

      await cache.warmCache(async () => data);

      const appConfig = await cache.get('config:app');
      const apiConfig = await cache.get('config:api');

      expect(appConfig).toEqual({ version: '1.0.0' });
      expect(apiConfig).toEqual({ endpoint: 'https://api.example.com' });
    });

    test('should handle large batches', async () => {
      const data = Array.from({ length: 250 }, (_, i) => ({
        id: `item-${i}`,
        value: i
      }));

      await cache.warmCache(async () => data, {
        batchSize: 50,
        keyExtractor: item => item.id
      });

      const result0 = await cache.get('item-0');
      const result100 = await cache.get('item-100');
      const result249 = await cache.get('item-249');

      expect(result0).toEqual({ id: 'item-0', value: 0 });
      expect(result100).toEqual({ id: 'item-100', value: 100 });
      expect(result249).toEqual({ id: 'item-249', value: 249 });
    });
  });

  describe('Locking', () => {
    test('should acquire and release lock', async () => {
      const lock = await cache.lock('resource1');
      expect(lock).toHaveProperty('token');
      expect(lock).toHaveProperty('release');

      const released = await lock.release();
      expect(released).toBe(1);
    });

    test('should prevent concurrent locks', async () => {
      const lock1 = await cache.lock('resource2');
      
      await expect(cache.lock('resource2', { retries: 2, retryDelay: 10 }))
        .rejects.toThrow('Failed to acquire lock for key: resource2');

      await lock1.release();
    });

    test('should retry lock acquisition', async () => {
      const lock1 = await cache.lock('resource3');
      
      setTimeout(async () => {
        await lock1.release();
      }, 50);

      const lock2 = await cache.lock('resource3', { retries: 10, retryDelay: 20 });
      expect(lock2).toHaveProperty('token');
      await lock2.release();
    });
  });

  describe('Error Handling', () => {
    test('should handle get errors with fallback', async () => {
      const mockError = new Error('Redis error');
      jest.spyOn(cache.client, 'get').mockRejectedValueOnce(mockError);

      const result = await cache.get('errorKey', {
        fallback: 'defaultValue'
      });
      expect(result).toBe('defaultValue');
    });

    test('should handle get errors with fallback function', async () => {
      const mockError = new Error('Redis error');
      jest.spyOn(cache.client, 'get').mockRejectedValueOnce(mockError);

      const result = await cache.get('errorKey', {
        fallback: async () => ({ computed: 'value' })
      });
      expect(result).toEqual({ computed: 'value' });
    });
  });

  describe('Stats', () => {
    test('should get cache statistics', async () => {
      const stats = await cache.getStats();
      
      expect(stats).toHaveProperty('connections');
      expect(stats).toHaveProperty('commands');
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('memory');
      expect(stats.memory).toHaveProperty('used');
      expect(stats.memory).toHaveProperty('peak');
      expect(stats.memory).toHaveProperty('rss');
    });
  });
});