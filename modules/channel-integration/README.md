# Channel Integration Module

Multi-channel inventory synchronization module for Fluxor with conflict resolution and rate limiting.

## Features

- Multi-channel adapter architecture
- Bidirectional synchronization
- Conflict resolution strategies
- Rate limiting per channel
- Webhook processing
- Field mapping and transformations
- Scheduled and real-time sync
- Built-in adapters for major platforms

## Installation

```bash
npm install @fluxor/channel-integration-module
```

## Usage

```javascript
const ChannelIntegrationModule = require('@fluxor/channel-integration-module');

// Initialize with dependencies
const channelIntegration = new ChannelIntegrationModule({
  syncInterval: 300000, // 5 minutes
  conflictStrategy: 'latest-wins',
  enableWebhooks: true,
  webhookBaseUrl: 'https://api.example.com'
});

await channelIntegration.initialize({
  eventBus: eventBusInstance,
  database: databaseInstance,
  queue: queueInstance
});

// Connect a Shopify channel
const channel = await channelIntegration.connectChannel({
  type: 'shopify',
  name: 'Main Shopify Store',
  config: {
    shop: 'mystore',
    accessToken: 'shpat_xxxxx',
    apiVersion: '2024-01'
  },
  settings: {
    syncEnabled: true,
    syncInterval: 600000, // 10 minutes
    fieldMappings: {
      inbound: {
        'title': 'name',
        'body_html': 'description'
      }
    }
  }
});

// Perform manual sync
const syncResult = await channelIntegration.syncChannel(channel.id, {
  resources: ['products', 'inventory'],
  direction: 'bidirectional'
});

// Handle webhooks
await channelIntegration.handleWebhook(
  channel.id,
  'products/update',
  webhookData
);
```

## Channel Configuration

### Shopify

```javascript
{
  type: 'shopify',
  config: {
    shop: 'mystore',              // Required: Shop domain
    accessToken: 'shpat_xxx',     // Required: Private app token
    apiVersion: '2024-01'         // Optional: API version
  }
}
```

### Amazon

```javascript
{
  type: 'amazon',
  config: {
    sellerId: 'A1XXX',           // Required: Seller ID
    refreshToken: 'Atzr|xxx',    // Required: LWA refresh token
    clientId: 'amzn1.app.xxx',   // Required: App client ID
    clientSecret: 'xxx',         // Required: App client secret
    region: 'us-east-1',         // Optional: AWS region
    marketplace: 'ATVPDKIKX0DER' // Optional: Marketplace ID
  }
}
```

### WooCommerce

```javascript
{
  type: 'woocommerce',
  config: {
    url: 'https://mystore.com',  // Required: Store URL
    consumerKey: 'ck_xxx',       // Required: REST API key
    consumerSecret: 'cs_xxx',    // Required: REST API secret
    version: 'wc/v3'             // Optional: API version
  }
}
```

### eBay

```javascript
{
  type: 'ebay',
  config: {
    appId: 'xxx',                // Required: App ID
    certId: 'xxx',               // Required: Cert ID
    devId: 'xxx',                // Required: Dev ID
    userToken: 'xxx',            // Required: User auth token
    siteId: 0,                   // Optional: eBay site ID
    sandbox: false               // Optional: Use sandbox
  }
}
```

## Sync Options

```javascript
// Full sync
await channelIntegration.syncChannel(channelId, {
  fullSync: true,
  resources: ['products', 'inventory', 'orders'],
  direction: 'bidirectional'
});

// Incremental sync (since last sync)
await channelIntegration.syncChannel(channelId, {
  fullSync: false,
  resources: ['inventory'],
  direction: 'inbound'
});

// One-way sync
await channelIntegration.syncChannel(channelId, {
  resources: ['orders'],
  direction: 'inbound' // or 'outbound'
});
```

## Conflict Resolution

Built-in strategies:
- `latest-wins`: Most recently updated item wins
- `local-wins`: Local data always takes precedence
- `remote-wins`: Remote data always takes precedence
- `merge`: Attempts to merge changes
- `manual`: Queues conflicts for manual review
- `conservative`: Special handling (e.g., lowest inventory)

Custom resolver:
```javascript
channelIntegration.conflictResolver.registerResolver('products', 
  async (local, remote, context) => {
    if (local.price < remote.price) {
      return {
        action: 'skip',
        reason: 'Local price is lower'
      };
    }
    return {
      action: 'update',
      data: remote,
      reason: 'Remote price is higher'
    };
  }
);
```

## Field Mappings

```javascript
{
  settings: {
    fieldMappings: {
      inbound: {
        // Remote field -> Local field
        'title': 'name',
        'body_html': 'description',
        'variants.0.price': 'price',
        'vendor': 'brand'
      },
      outbound: {
        // Local field -> Remote field
        'name': 'title',
        'description': 'body_html',
        'brand': 'vendor'
      }
    }
  }
}
```

## Rate Limiting

```javascript
// Set custom rate limits
await channelIntegration.rateLimiter.setChannelLimit(
  channelId,
  'products:read',
  { requests: 200, window: 60 } // 200 requests per minute
);

// Check rate limit status
const status = await channelIntegration.getChannelStatus(channelId);
console.log(status.rateLimits);

// Reset rate limits
await channelIntegration.rateLimiter.reset(channelId);
```

## Webhook Processing

```javascript
// Express route example
app.post('/webhooks/channels/:channelId/webhook', async (req, res) => {
  const { channelId } = req.params;
  const topic = req.query.topic;
  
  try {
    await channelIntegration.handleWebhook(
      channelId,
      topic,
      req.body
    );
    res.status(200).send('OK');
  } catch (error) {
    res.status(500).send(error.message);
  }
});
```

## Events

```javascript
channelIntegration.on('channel:connected', ({ channelId, type, name }) => {
  console.log(`Channel connected: ${name} (${type})`);
});

channelIntegration.on('channel:synced', ({ channelId, duration, result }) => {
  console.log(`Sync completed in ${duration}ms`, result.stats);
});

channelIntegration.on('channel:error', ({ channelId, error, type }) => {
  console.error(`Channel error: ${error}`);
});

channelIntegration.on('webhook:processed', ({ channelId, event, result }) => {
  console.log(`Webhook processed: ${event}`);
});
```

## Channel Management

```javascript
// Get all channels
const channels = await channelIntegration.getChannels();

// Filter channels
const activeChannels = await channelIntegration.getChannels({
  status: 'connected',
  syncEnabled: true
});

// Update channel settings
await channelIntegration.updateChannelSettings(channelId, {
  syncInterval: 900000, // 15 minutes
  autoSync: {
    inventory: true,
    orders: true
  }
});

// Disconnect channel
await channelIntegration.disconnectChannel(channelId);

// Test connection
const testResult = await channelIntegration.testConnection('shopify', {
  shop: 'teststore',
  accessToken: 'shpat_test'
});
```

## Custom Adapters

```javascript
const BaseAdapter = require('@fluxor/channel-integration-module/src/adapters/BaseAdapter');

class CustomAdapter extends BaseAdapter {
  async connect() {
    // Implementation
  }
  
  async fetchResources(resource, options) {
    // Implementation
  }
  
  // ... other required methods
}

// Register adapter
channelIntegration.registerAdapter('custom', CustomAdapter);
```

## Error Handling

```javascript
try {
  await channelIntegration.syncChannel(channelId);
} catch (error) {
  if (error.name === 'RateLimitError') {
    console.log(`Rate limited. Retry after ${error.details.waitTime}ms`);
  } else if (error.code === 'CHANNEL_NOT_CONNECTED') {
    await channelIntegration.connectChannel(channelConfig);
  } else {
    console.error('Sync failed:', error);
  }
}
```