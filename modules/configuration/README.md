# Configuration Module

Centralized configuration management with multiple providers, dynamic updates, and feature flags for Fluxor.

## Features

- **Multiple Providers**: Environment variables, files, database, and remote sources
- **Provider Priority**: Layered configuration with customizable precedence
- **Dynamic Updates**: Real-time configuration changes without restarts
- **Feature Flags**: Advanced feature management with multiple strategies
- **Schema Validation**: Joi-based configuration validation
- **Change Notifications**: Watch and react to configuration changes
- **Type Safety**: Automatic type conversion and validation

## Installation

```bash
npm install @fluxor/configuration
```

## Usage

### Basic Setup

```javascript
const ConfigurationModule = require('@fluxor/configuration');

const configModule = new ConfigurationModule({
  providers: {
    environment: {
      enabled: true,
      priority: 100,
      prefix: 'FLUXOR_',
      includeSystemEnv: true
    },
    file: {
      enabled: true,
      priority: 50,
      filePath: './config/app.json',
      format: 'json',
      watch: true
    },
    database: {
      enabled: true,
      priority: 10,
      tableName: 'configurations'
    }
  },
  featureFlags: {
    enabled: true,
    recordEvaluations: true
  },
  defaultWriteProvider: 'database'
});

// Initialize with dependencies
await configModule.initialize({
  database: databaseModule,
  cache: cacheModule,
  eventBus: eventBusModule
});
```

### Getting Configuration Values

```javascript
// Simple get
const dbHost = await configModule.get('database.host', 'localhost');

// Get multiple values
const configs = await configModule.getMany([
  'database.host',
  'database.port',
  'redis.url'
]);

// Get with pattern
const allDbConfigs = await configModule.getPattern('database.*');
```

### Setting Configuration Values

```javascript
// Set single value
await configModule.set('app.name', 'Fluxor', {
  provider: 'database' // Optional: specify target provider
});

// Set multiple values
await configModule.setMany({
  'app.version': '2.0.0',
  'app.environment': 'production'
});

// Delete configuration
await configModule.delete('deprecated.feature');
```

### Schema Validation

```javascript
const Joi = require('joi');

// Register schema for configuration
configModule.registerSchema('database.port', 
  Joi.number().port().required(),
  5432 // default value
);

// Register multiple schemas
configModule.registerSchemas({
  'app.name': {
    schema: Joi.string().required(),
    default: 'Fluxor'
  },
  'app.maxConnections': {
    schema: Joi.number().min(1).max(1000),
    default: 100
  },
  'app.features': {
    schema: Joi.array().items(Joi.string()),
    default: []
  }
});
```

### Watching Configuration Changes

```javascript
// Watch specific key
const unwatch = configModule.watch('database.host', (change) => {
  console.log(`Database host changed from ${change.oldValue} to ${change.value}`);
  // Reconnect to database with new host
});

// Watch multiple keys
configModule.watch(['redis.*', 'cache.*'], (change) => {
  console.log(`Cache configuration changed: ${change.key}`);
});

// Watch all changes
configModule.on('change', (change) => {
  console.log('Configuration changed:', change);
});

// Stop watching
unwatch();
```

### Feature Flags

```javascript
// Create feature flag
await configModule.createFeatureFlag({
  key: 'new_checkout_flow',
  name: 'New Checkout Flow',
  description: 'Redesigned checkout process with one-page flow',
  strategy: 'percentage',
  rules: {
    percentage: 25 // Roll out to 25% of users
  }
});

// Evaluate feature flag
const isEnabled = await configModule.getFeatureFlag('new_checkout_flow', {
  userId: 'user123',
  tenantId: 'tenant456',
  attributes: {
    plan: 'premium',
    country: 'US'
  }
});

if (isEnabled.enabled) {
  // Show new checkout flow
}

// Update feature flag
await configModule.updateFeatureFlag('new_checkout_flow', {
  strategy: 'gradual',
  rules: {
    startDate: '2024-01-01',
    endDate: '2024-01-31'
  }
});

// List all feature flags
const flags = await configModule.listFeatureFlags({
  status: 'enabled',
  tags: ['frontend', 'experiment']
});
```

## Configuration Providers

### Environment Provider

```javascript
{
  environment: {
    enabled: true,
    priority: 100,
    prefix: 'FLUXOR_',        // Environment variable prefix
    delimiter: '__',          // Nested key delimiter
    includeSystemEnv: true,   // Include non-prefixed vars
    envFile: '.env'          // Optional .env file
  }
}
```

Environment variables are mapped to configuration keys:
- `FLUXOR_DATABASE__HOST` → `database.host`
- `FLUXOR_REDIS__PORT` → `redis.port`

### File Provider

```javascript
{
  file: {
    enabled: true,
    priority: 50,
    filePath: './config.json',
    format: 'json',    // json, yaml, properties, ini
    watch: true        // Watch for file changes
  }
}
```

Supported formats:
- **JSON**: Standard JSON files
- **YAML**: YAML configuration files
- **Properties**: Java-style properties files
- **INI**: INI configuration files

### Database Provider

```javascript
{
  database: {
    enabled: true,
    priority: 10,
    tableName: 'configurations',
    scope: 'global',     // global, tenant, user, service
    scopeId: null,       // ID for scoped configs
    encryptionKey: null  // For sensitive values
  }
}
```

## Feature Flag Strategies

### Boolean Strategy
Simple on/off toggle:
```javascript
{
  strategy: 'boolean',
  rules: {
    enabled: true
  }
}
```

### Percentage Strategy
Gradual rollout based on user hash:
```javascript
{
  strategy: 'percentage',
  rules: {
    percentage: 50,
    salt: 'unique-salt' // Optional
  }
}
```

### User List Strategy
Enable for specific users:
```javascript
{
  strategy: 'user_list',
  rules: {
    users: ['user123', 'user456']
  }
}
```

### Group Strategy
Enable based on user attributes:
```javascript
{
  strategy: 'group',
  rules: {
    groups: [{
      name: 'Premium Users',
      operator: 'AND',
      conditions: [
        {
          attribute: 'attributes.plan',
          operator: 'equals',
          value: 'premium'
        },
        {
          attribute: 'attributes.country',
          operator: 'in',
          value: ['US', 'CA', 'UK']
        }
      ]
    }]
  }
}
```

### Gradual Strategy
Time-based rollout:
```javascript
{
  strategy: 'gradual',
  rules: {
    startDate: '2024-01-01T00:00:00Z',
    endDate: '2024-02-01T00:00:00Z'
  }
}
```

### Custom Strategy
Register your own strategy:
```javascript
configModule.featureFlagService.registerStrategy('custom', {
  evaluate: async (rules, context) => {
    // Custom evaluation logic
    return {
      enabled: true,
      reason: 'Custom logic passed',
      variant: 'A'
    };
  }
});
```

## Events

The module emits the following events:

- `change` - When any configuration value changes
  ```javascript
  {
    key: 'database.host',
    value: 'new-host',
    oldValue: 'old-host',
    source: 'environment',
    timestamp: Date
  }
  ```

## Best Practices

1. **Use Schema Validation**: Define schemas for all critical configurations
2. **Set Appropriate Priorities**: Higher priority for runtime overrides
3. **Encrypt Sensitive Values**: Use encryption for passwords and secrets
4. **Monitor Changes**: Set up watchers for critical configurations
5. **Use Feature Flags**: Gradually roll out new features
6. **Cache Wisely**: Balance performance with consistency

## API Reference

See the [API documentation](./docs/api.md) for detailed method descriptions.

## Examples

See the [examples directory](./examples) for more usage examples.