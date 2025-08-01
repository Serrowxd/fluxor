# Service Registry Module

Provides service discovery and health monitoring capabilities for the Fluxor modular architecture.

## Features

- **Service Registration/Deregistration**: Dynamic service registration with metadata
- **Health Checking**: Multiple health check types (HTTP, TCP, Exec, TTL)
- **Load Balancing**: Multiple strategies (round-robin, least-connections, weighted, random, IP-hash)
- **Circuit Breaker**: Fault tolerance with configurable thresholds
- **Service Discovery**: High-level API combining all components

## Usage

```javascript
const { 
  ServiceRegistry, 
  HealthChecker, 
  LoadBalancer, 
  CircuitBreaker, 
  ServiceDiscovery 
} = require('@fluxor/service-registry');

// Initialize components
const registry = new ServiceRegistry({ enablePersistence: true });
const healthChecker = new HealthChecker({ interval: 10000 });
const loadBalancer = new LoadBalancer('round-robin');
const circuitBreaker = new CircuitBreaker({ 
  failureThreshold: 5,
  resetTimeout: 30000 
});

// Create service discovery instance
const discovery = new ServiceDiscovery(
  registry, 
  healthChecker, 
  loadBalancer, 
  circuitBreaker
);

// Register a service
const service = await registry.register({
  name: 'inventory-service',
  version: '1.0.0',
  host: 'localhost',
  port: 3001,
  protocol: 'http',
  tags: ['inventory', 'core'],
  metadata: {
    region: 'us-east-1',
    capabilities: ['read', 'write']
  }
});

// Start health checks
healthChecker.startHealthChecks(service, {
  interval: 5000,
  checks: [{
    name: 'http-health',
    type: 'http',
    path: '/health',
    timeout: 3000
  }]
});

// Discover and execute request
await discovery.execute(
  { name: 'inventory-service', healthyOnly: true },
  async (service) => {
    // Make request to service
    return await fetch(`${service.protocol}://${service.host}:${service.port}/api/inventory`);
  }
);

// Watch for service changes
const unwatch = discovery.watch(
  { name: 'inventory-service' },
  (services) => {
    console.log('Available services:', services);
  }
);

// Get statistics
const stats = discovery.getStats();
```

## API Reference

### ServiceRegistry

- `register(serviceDefinition)`: Register a new service
- `deregister(serviceId)`: Remove a service
- `heartbeat(serviceId)`: Update service heartbeat
- `findServices(query)`: Find services by query
- `getService(serviceId)`: Get specific service
- `getAllServices()`: Get all registered services

### HealthChecker

- `startHealthChecks(service, config)`: Start health monitoring
- `stopHealthChecks(serviceId)`: Stop health monitoring
- `checkHealth(service, config)`: Perform one-time health check
- `getHealthStatus(serviceId)`: Get current health status

### LoadBalancer

- `selectInstance(services, context)`: Select service instance
- `updateConnections(serviceId, delta)`: Update connection count
- `clearStickySession(sessionId)`: Clear sticky session

### CircuitBreaker

- `execute(serviceId, fn)`: Execute with circuit breaker protection
- `trip(serviceId)`: Manually open circuit
- `reset(serviceId)`: Manually close circuit
- `getState(serviceId)`: Get circuit state

### ServiceDiscovery

- `discover(query, context)`: Find and select healthy service
- `execute(query, requestFn, context)`: Execute with full discovery flow
- `getAvailableServices(query)`: Get all available services
- `watch(query, callback)`: Watch for service changes

## Health Check Types

1. **HTTP**: Check HTTP endpoint
2. **TCP**: Check TCP connectivity
3. **Exec**: Execute command
4. **TTL**: Time-to-live based

## Load Balancing Strategies

1. **round-robin**: Sequential selection
2. **least-connections**: Select least loaded
3. **weighted**: Weight-based selection
4. **random**: Random selection
5. **ip-hash**: Client IP based selection

## Circuit Breaker States

1. **closed**: Normal operation
2. **open**: Failing, requests blocked
3. **half-open**: Testing recovery

## Events

- `service-registered`: New service registered
- `service-deregistered`: Service removed
- `service-healthy`: Service became healthy
- `service-unhealthy`: Service became unhealthy
- `circuit-breaker-open`: Circuit opened
- `circuit-breaker-closed`: Circuit closed
- `circuit-breaker-half-open`: Circuit testing