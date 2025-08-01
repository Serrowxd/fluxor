/**
 * Load Balancer - Service load balancing strategies
 * @module service-registry/services/LoadBalancer
 */

const crypto = require('crypto');
const { LOAD_BALANCING_STRATEGIES } = require('../constants');

class LoadBalancer {
  constructor(strategy = LOAD_BALANCING_STRATEGIES.ROUND_ROBIN) {
    this.strategy = strategy;
    this.roundRobinIndex = new Map();
    this.connections = new Map();
    this.stickySession = new Map();
  }

  /**
   * Select a service instance based on configured strategy
   * @param {Array<Object>} services - Available service instances
   * @param {Object} context - Request context for routing decisions
   * @returns {Object|null} Selected service instance
   */
  selectInstance(services, context = {}) {
    if (!services || services.length === 0) {
      return null;
    }

    // Filter only healthy services
    const healthyServices = services.filter(s => 
      !s.health || s.health.healthy !== false
    );

    if (healthyServices.length === 0) {
      return null;
    }

    // Check sticky session
    if (context.sessionId && this.stickySession.has(context.sessionId)) {
      const stickyServiceId = this.stickySession.get(context.sessionId);
      const stickyService = healthyServices.find(s => s.id === stickyServiceId);
      if (stickyService) {
        return stickyService;
      }
    }

    let selected = null;

    switch (this.strategy) {
      case LOAD_BALANCING_STRATEGIES.ROUND_ROBIN:
        selected = this._roundRobin(healthyServices, context);
        break;
      
      case LOAD_BALANCING_STRATEGIES.LEAST_CONNECTIONS:
        selected = this._leastConnections(healthyServices);
        break;
      
      case LOAD_BALANCING_STRATEGIES.WEIGHTED:
        selected = this._weighted(healthyServices);
        break;
      
      case LOAD_BALANCING_STRATEGIES.RANDOM:
        selected = this._random(healthyServices);
        break;
      
      case LOAD_BALANCING_STRATEGIES.IP_HASH:
        selected = this._ipHash(healthyServices, context);
        break;
      
      default:
        selected = this._roundRobin(healthyServices, context);
    }

    // Update sticky session if enabled
    if (context.sessionId && selected) {
      this.stickySession.set(context.sessionId, selected.id);
    }

    return selected;
  }

  /**
   * Update connection count for a service
   * @param {string} serviceId - Service ID
   * @param {number} delta - Connection change (+1 or -1)
   */
  updateConnections(serviceId, delta) {
    const current = this.connections.get(serviceId) || 0;
    const updated = Math.max(0, current + delta);
    
    if (updated === 0) {
      this.connections.delete(serviceId);
    } else {
      this.connections.set(serviceId, updated);
    }
  }

  /**
   * Clear sticky session
   * @param {string} sessionId - Session ID
   */
  clearStickySession(sessionId) {
    this.stickySession.delete(sessionId);
  }

  /**
   * Round-robin selection
   * @private
   */
  _roundRobin(services, context) {
    const key = context.serviceName || 'default';
    const currentIndex = this.roundRobinIndex.get(key) || 0;
    const selectedIndex = currentIndex % services.length;
    
    this.roundRobinIndex.set(key, currentIndex + 1);
    
    return services[selectedIndex];
  }

  /**
   * Least connections selection
   * @private
   */
  _leastConnections(services) {
    let minConnections = Infinity;
    let selected = null;

    for (const service of services) {
      const connections = this.connections.get(service.id) || 0;
      if (connections < minConnections) {
        minConnections = connections;
        selected = service;
      }
    }

    return selected || services[0];
  }

  /**
   * Weighted selection
   * @private
   */
  _weighted(services) {
    const totalWeight = services.reduce((sum, s) => sum + (s.weight || 1), 0);
    let random = Math.random() * totalWeight;

    for (const service of services) {
      random -= (service.weight || 1);
      if (random <= 0) {
        return service;
      }
    }

    return services[services.length - 1];
  }

  /**
   * Random selection
   * @private
   */
  _random(services) {
    const index = Math.floor(Math.random() * services.length);
    return services[index];
  }

  /**
   * IP hash selection
   * @private
   */
  _ipHash(services, context) {
    if (!context.clientIp) {
      return this._random(services);
    }

    const hash = crypto
      .createHash('md5')
      .update(context.clientIp)
      .digest('hex');
    
    const hashValue = parseInt(hash.substr(0, 8), 16);
    const index = hashValue % services.length;
    
    return services[index];
  }

  /**
   * Get load balancer statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      strategy: this.strategy,
      connections: Object.fromEntries(this.connections),
      stickySessions: this.stickySession.size,
      roundRobinIndexes: Object.fromEntries(this.roundRobinIndex)
    };
  }

  /**
   * Reset load balancer state
   */
  reset() {
    this.roundRobinIndex.clear();
    this.connections.clear();
    this.stickySession.clear();
  }
}

module.exports = LoadBalancer;