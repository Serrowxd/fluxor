# Tenant Management Module

Multi-tenant isolation and management for the Fluxor modular architecture.

## Features

- **Tenant Service**: Core tenant CRUD operations
- **Tenant Isolation**: Multiple isolation strategies (schema, database, row-level, partition)
- **Resource Quota**: Usage tracking and limit enforcement
- **Tenant Configuration**: Tenant-specific settings management
- **Tenant Migration**: Export, import, clone, and merge operations
- **Middleware**: Request isolation and authorization

## Usage

```javascript
const { 
  TenantService,
  TenantIsolation,
  ResourceQuota,
  TenantConfiguration,
  TenantMigration,
  middleware
} = require('@fluxor/tenant-management');

// Initialize services
const tenantService = new TenantService({ database: dbConfig });
const isolation = new TenantIsolation({ strategy: 'schema' });
const quota = new ResourceQuota({ enforcementMode: 'hard' });
const config = new TenantConfiguration();
const migration = new TenantMigration();

// Create a tenant
const tenant = await tenantService.createTenant({
  name: 'Acme Corp',
  settings: {
    timezone: 'America/New_York',
    locale: 'en-US'
  },
  limits: {
    users: 50,
    storage: 5368709120, // 5GB
    apiCalls: 100000
  }
});

// Add user to tenant
await tenantService.addUser(tenant.id, userId, ['admin']);

// Set tenant configuration
await config.setConfiguration(tenant.id, 'features', {
  analytics: { enabled: true },
  multiChannel: { enabled: false }
});

// Check resource usage
const usageCheck = await quota.checkUsage(tenant.id, tenant.limits);
if (usageCheck.violations.length > 0) {
  console.log('Quota violations:', usageCheck.violations);
}

// Clone tenant
const clonedTenant = await migration.cloneTenant(tenant.id, {
  name: 'Acme Corp - Staging',
  slug: 'acme-staging'
});

// Apply middleware in Express
app.use(middleware.tenantIsolation(isolation));
app.use(middleware.tenantStatus(tenantService));
app.use(middleware.tenantAuthorization(tenantService));
app.use(middleware.resourceQuota(quota, tenantService));
```

## API Reference

### TenantService

- `createTenant(data)`: Create new tenant
- `getTenant(tenantId)`: Get tenant by ID
- `updateTenant(tenantId, updates)`: Update tenant
- `suspendTenant(tenantId, reason)`: Suspend tenant
- `activateTenant(tenantId)`: Activate tenant
- `terminateTenant(tenantId)`: Terminate tenant
- `addUser(tenantId, userId, roles)`: Add user to tenant
- `removeUser(tenantId, userId)`: Remove user from tenant
- `getUserTenants(userId)`: Get user's tenants

### TenantIsolation

- `setContext(context)`: Set tenant context
- `getContext()`: Get current context
- `executeInContext(context, fn)`: Execute in tenant context
- `getConnection(tenantId)`: Get tenant database connection
- `applyTenantFilter(query, tenantId)`: Apply tenant filtering
- `validateCrossTenantAccess(source, target, op)`: Validate cross-tenant access

### ResourceQuota

- `checkUsage(tenantId, limits)`: Check resource usage
- `getUsage(tenantId)`: Get current usage
- `updateUsage(tenantId, resource, delta)`: Update usage
- `enforceQuota(tenantId, resource, requested, limits)`: Enforce limits
- `getUsageStats(tenantId)`: Get usage statistics

### TenantConfiguration

- `getConfiguration(tenantId, namespace)`: Get configuration
- `setConfiguration(tenantId, namespace, config)`: Set configuration
- `getValue(tenantId, path, default)`: Get value by path
- `setValue(tenantId, path, value)`: Set value by path
- `applyTemplate(tenantId, template, vars)`: Apply template
- `exportConfiguration(tenantId)`: Export all config
- `importConfiguration(tenantId, data)`: Import config

### TenantMigration

- `exportTenant(tenantId, options)`: Export tenant data
- `importTenant(tenantId, data, options)`: Import tenant data
- `cloneTenant(sourceId, targetData, options)`: Clone tenant
- `mergeTenants(sourceIds, targetId, options)`: Merge tenants
- `getMigrationStatus(migrationId)`: Get migration status

## Middleware

### tenantIsolation
Ensures requests execute in proper tenant context.

### tenantStatus
Validates tenant is active and not expired.

### tenantAuthorization
Validates user belongs to tenant.

### resourceQuota
Enforces resource limits per request.

### featureFlag
Checks if tenant has access to feature.

### crossTenantAccess
Validates cross-tenant operations.

## Isolation Strategies

1. **Database**: Separate database per tenant
2. **Schema**: Separate schema per tenant
3. **Row-Level**: Tenant ID column filtering
4. **Partition**: Table partitioning by tenant

## Events

- `tenant.created`: New tenant created
- `tenant.updated`: Tenant updated
- `tenant.suspended`: Tenant suspended
- `tenant.activated`: Tenant activated
- `tenant.terminated`: Tenant terminated
- `tenant.limit_exceeded`: Resource limit exceeded
- `tenant.quota_warning`: Approaching resource limit
- `tenant.user_added`: User added to tenant
- `tenant.user_removed`: User removed from tenant

## Configuration

```javascript
{
  // Isolation strategy
  isolation: {
    strategy: 'schema', // or 'database', 'row_level', 'partition'
  },
  
  // Default limits
  defaults: {
    limits: {
      users: 10,
      storage: 1073741824, // 1GB
      apiCalls: 10000
    },
    features: {
      multiChannel: false,
      advancedAnalytics: false
    }
  },
  
  // Quota enforcement
  quota: {
    enforcementMode: 'soft', // or 'hard'
    gracePeriod: 86400000 // 24 hours
  }
}