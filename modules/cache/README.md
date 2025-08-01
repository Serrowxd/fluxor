# Cache Module

High-performance distributed caching module for Fluxor with Redis support.

## Features

- Redis and Redis Cluster support
- Key pattern management
- Cache invalidation strategies
- Distributed locking
- Cache warming utilities
- Batch operations
- TTL management
- Performance monitoring

## Installation

```bash
npm install @fluxor/cache-module
```

## Usage

```javascript
const CacheModule = require('@fluxor/cache-module');

// Initialize cache
const cache = new CacheModule({
  host: 'localhost',
  port: 6379,
  keyPrefix: 'fluxor:',
  defaultTTL: 3600
});

await cache.initialize();

// Basic operations
await cache.set('user:123', { name: 'John', email: 'john@example.com' });
const user = await cache.get('user:123');

// Using TTL
await cache.set('session:abc', { userId: 123 }, { ttl: 1800 });

// Batch operations
await cache.mset({
  'product:1': { name: 'Product 1', price: 99.99 },
  'product:2': { name: 'Product 2', price: 149.99 }
});

const products = await cache.mget(['product:1', 'product:2']);

// Using key patterns
const userKey = cache.generateKey('user', userId);
const inventoryKey = cache.generateKey('inventory', productId);

// Cache warming
await cache.warmCache(async () => {
  return await fetchAllProducts();
}, {
  keyExtractor: product => `product:${product.id}`,
  ttl: 7200
});

// Distributed locking
const lock = await cache.lock('resource:critical', {
  ttl: 30,
  retries: 10
});

try {
  // Perform critical operation
} finally {
  await lock.release();
}

// Cache invalidation
await cache.invalidate('cascade', 'user:123');
await cache.invalidate('pattern', 'session:*');
```

## Configuration

```javascript
const cache = new CacheModule({
  // Redis connection
  host: 'localhost',
  port: 6379,
  password: 'secret',
  db: 0,
  
  // Cluster mode
  enableCluster: false,
  clusterNodes: [
    { host: 'node1', port: 6379 },
    { host: 'node2', port: 6379 }
  ],
  
  // Cache settings
  keyPrefix: 'fluxor:',
  defaultTTL: 3600,
  
  // Connection settings
  connectTimeout: 5000,
  commandTimeout: 5000,
  retryStrategy: (times) => Math.min(times * 50, 2000)
});
```

## Key Patterns

Built-in patterns:
- `user`: `user:{userId}`
- `inventory`: `inventory:{productId}`
- `order`: `order:{orderId}`
- `session`: `session:{sessionId}`
- `analytics`: `analytics:{metric}:{date}`
- `forecast`: `forecast:{productId}:{date}`
- `channel`: `channel:{channelId}:{resource}`

Register custom patterns:
```javascript
cache.registerKeyPattern('custom', (type, id) => `custom:${type}:${id}`);
```

## Invalidation Strategies

Built-in strategies:
- `cascade`: Delete key and all sub-keys
- `tag`: Delete all keys with specific tag
- `pattern`: Delete all keys matching pattern

Register custom strategies:
```javascript
cache.registerInvalidationStrategy('custom', async (param) => {
  // Custom invalidation logic
});
```

## Error Handling

```javascript
// With fallback value
const data = await cache.get('key', {
  fallback: 'default'
});

// With fallback function
const data = await cache.get('key', {
  fallback: async () => {
    return await fetchFromDatabase();
  }
});
```

## Performance Monitoring

```javascript
const stats = await cache.getStats();
console.log(`Hit rate: ${stats.hits / (stats.hits + stats.misses) * 100}%`);
console.log(`Memory usage: ${stats.memory.used / 1024 / 1024}MB`);
```

## API Reference

### Core Methods

- `initialize()`: Initialize cache connection
- `get(key, options)`: Get value by key
- `set(key, value, options)`: Set value with optional TTL
- `del(key)`: Delete key
- `exists(key)`: Check if key exists
- `expire(key, ttl)`: Set key expiration
- `ttl(key)`: Get remaining TTL

### Batch Operations

- `mget(keys)`: Get multiple values
- `mset(keyValuePairs, options)`: Set multiple values

### Utility Methods

- `generateKey(pattern, ...args)`: Generate key using pattern
- `warmCache(warmer, options)`: Bulk load data into cache
- `lock(key, options)`: Acquire distributed lock
- `invalidate(strategy, ...args)`: Invalidate cache entries
- `getStats()`: Get cache statistics
- `disconnect()`: Close cache connection