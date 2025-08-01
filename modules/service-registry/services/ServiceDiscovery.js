/**
 * Service Discovery - High-level service discovery API
 * @module service-registry/services/ServiceDiscovery
 */

const EventEmitter = require('events');

class ServiceDiscovery extends EventEmitter {
  constructor(serviceRegistry, healthChecker, loadBalancer, circuitBreaker) {
    super();
    this.registry = serviceRegistry;
    this.healthChecker = healthChecker;
    this.loadBalancer = loadBalancer;
    this.circuitBreaker = circuitBreaker;
  }

  /**
   * Discover and select a healthy service instance
   * @param {Object} query - Service query parameters
   * @param {Object} context - Request context
   * @returns {Promise<Object|null>} Selected service instance
   */
  async discover(query, context = {}) {
    // Find matching services
    const services = this.registry.findServices(query);
    if (services.length === 0) {
      return null;
    }

    // Enrich with health status
    const enrichedServices = services.map(service => ({
      ...service,
      health: this.healthChecker.getHealthStatus(service.id),
      circuitBreaker: this.circuitBreaker.getState(service.id)
    }));

    // Filter out services with open circuit breakers
    const availableServices = enrichedServices.filter(service => 
      service.circuitBreaker.state !== 'open'
    );

    if (availableServices.length === 0) {
      return null;
    }

    // Select instance using load balancer
    const selected = this.loadBalancer.selectInstance(availableServices, context);

    if (selected) {
      // Update connection count
      this.loadBalancer.updateConnections(selected.id, 1);
    }

    return selected;
  }

  /**
   * Execute request with service discovery and circuit breaker
   * @param {Object} query - Service query
   * @param {Function} requestFn - Request function
   * @param {Object} context - Request context
   * @returns {Promise<any>} Request result
   */
  async execute(query, requestFn, context = {}) {
    const service = await this.discover(query, context);
    if (!service) {
      throw new Error('No available service instances');
    }

    try {
      const result = await this.circuitBreaker.execute(service.id, async () => {
        return await requestFn(service);
      });

      // Update connection count on success
      this.loadBalancer.updateConnections(service.id, -1);
      
      return result;
    } catch (error) {
      // Update connection count on failure
      this.loadBalancer.updateConnections(service.id, -1);
      
      // Try next available instance if circuit breaker is open
      if (error.message.includes('Circuit breaker is OPEN')) {
        const nextService = await this.discover(query, context);
        if (nextService && nextService.id !== service.id) {
          return this.execute(query, requestFn, context);
        }
      }
      
      throw error;
    }
  }

  /**
   * Get available services for a query
   * @param {Object} query - Service query
   * @returns {Array<Object>} Available services with health and circuit breaker status
   */
  getAvailableServices(query) {
    const services = this.registry.findServices(query);
    
    return services.map(service => ({
      ...service,
      health: this.healthChecker.getHealthStatus(service.id),
      circuitBreaker: this.circuitBreaker.getState(service.id),
      connections: this.loadBalancer.connections.get(service.id) || 0
    })).filter(service => 
      service.health?.healthy !== false && 
      service.circuitBreaker.state !== 'open'
    );
  }

  /**
   * Watch for service changes
   * @param {Object} query - Service query
   * @param {Function} callback - Callback function
   * @returns {Function} Unwatch function
   */
  watch(query, callback) {
    const checkServices = () => {
      const services = this.getAvailableServices(query);
      callback(services);
    };

    // Listen to registry events
    const handlers = {
      'service-registered': checkServices,
      'service-deregistered': checkServices,
      'service-healthy': checkServices,
      'service-unhealthy': checkServices,
      'circuit-breaker-open': checkServices,
      'circuit-breaker-closed': checkServices
    };

    for (const [event, handler] of Object.entries(handlers)) {
      this.registry.on(event, handler);
      this.healthChecker.on(event, handler);
      this.circuitBreaker.on(event, handler);
    }

    // Initial callback
    checkServices();

    // Return unwatch function
    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        this.registry.removeListener(event, handler);
        this.healthChecker.removeListener(event, handler);
        this.circuitBreaker.removeListener(event, handler);
      }
    };
  }

  /**
   * Get discovery statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      registry: this.registry.getStats(),
      healthChecker: {
        totalChecks: this.healthChecker.getAllHealthStatuses().length,
        healthy: this.healthChecker.getAllHealthStatuses().filter(s => s.healthy).length
      },
      loadBalancer: this.loadBalancer.getStats(),
      circuitBreaker: this.circuitBreaker.getStats()
    };
  }
}

module.exports = ServiceDiscovery;