/**
 * Service Registry - Core service registration and discovery
 * @module service-registry/services/ServiceRegistry
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const { SERVICE_STATES, EVENTS } = require('../constants');

class ServiceRegistry extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.services = new Map();
    this.heartbeatTimers = new Map();
    this.deregisterTimers = new Map();
    
    if (config.database) {
      this._initializePersistence();
    }
  }

  /**
   * Register a new service
   * @param {Object} serviceDefinition - Service definition
   * @returns {Promise<Object>} Registered service with ID
   */
  async register(serviceDefinition) {
    const serviceId = serviceDefinition.id || uuidv4();
    const service = {
      ...serviceDefinition,
      id: serviceId,
      registeredAt: new Date(),
      lastHeartbeat: new Date(),
      state: SERVICE_STATES.STARTING
    };

    this.services.set(serviceId, service);
    this._startHeartbeatTimer(serviceId);
    
    if (this.config.enablePersistence) {
      await this._persistService(service);
    }

    this.emit(EVENTS.SERVICE_REGISTERED, { serviceId, service });
    return service;
  }

  /**
   * Deregister a service
   * @param {string} serviceId - Service ID
   * @returns {Promise<boolean>} Success status
   */
  async deregister(serviceId) {
    const service = this.services.get(serviceId);
    if (!service) {
      return false;
    }

    this._clearTimers(serviceId);
    this.services.delete(serviceId);
    
    if (this.config.enablePersistence) {
      await this._removePersistedService(serviceId);
    }

    this.emit(EVENTS.SERVICE_DEREGISTERED, { serviceId, service });
    return true;
  }

  /**
   * Update service heartbeat
   * @param {string} serviceId - Service ID
   * @returns {Promise<boolean>} Success status
   */
  async heartbeat(serviceId) {
    const service = this.services.get(serviceId);
    if (!service) {
      return false;
    }

    service.lastHeartbeat = new Date();
    service.state = SERVICE_STATES.HEALTHY;
    
    this._resetDeregisterTimer(serviceId);
    
    if (this.config.enablePersistence) {
      await this._persistService(service);
    }

    return true;
  }

  /**
   * Get service by ID
   * @param {string} serviceId - Service ID
   * @returns {Object|null} Service definition
   */
  getService(serviceId) {
    return this.services.get(serviceId) || null;
  }

  /**
   * Find services by query
   * @param {Object} query - Query parameters
   * @returns {Array<Object>} Matching services
   */
  findServices(query = {}) {
    let services = Array.from(this.services.values());

    if (query.name) {
      services = services.filter(s => s.name === query.name);
    }

    if (query.version) {
      services = services.filter(s => s.version === query.version);
    }

    if (query.tags && query.tags.length > 0) {
      services = services.filter(s => 
        query.tags.every(tag => s.tags && s.tags.includes(tag))
      );
    }

    if (query.healthyOnly) {
      services = services.filter(s => s.state === SERVICE_STATES.HEALTHY);
    }

    return services;
  }

  /**
   * Get all registered services
   * @returns {Array<Object>} All services
   */
  getAllServices() {
    return Array.from(this.services.values());
  }

  /**
   * Update service metadata
   * @param {string} serviceId - Service ID
   * @param {Object} metadata - Metadata to update
   * @returns {Promise<Object|null>} Updated service
   */
  async updateMetadata(serviceId, metadata) {
    const service = this.services.get(serviceId);
    if (!service) {
      return null;
    }

    service.metadata = { ...service.metadata, ...metadata };
    
    if (this.config.enablePersistence) {
      await this._persistService(service);
    }

    return service;
  }

  /**
   * Get service statistics
   * @returns {Object} Registry statistics
   */
  getStats() {
    const services = Array.from(this.services.values());
    const byState = services.reduce((acc, service) => {
      acc[service.state] = (acc[service.state] || 0) + 1;
      return acc;
    }, {});

    return {
      total: services.length,
      byState,
      services: services.map(s => ({
        id: s.id,
        name: s.name,
        version: s.version,
        state: s.state,
        uptime: Date.now() - new Date(s.registeredAt).getTime()
      }))
    };
  }

  /**
   * Start heartbeat timer for a service
   * @private
   */
  _startHeartbeatTimer(serviceId) {
    const interval = this.config.heartbeatInterval || 30000;
    const timer = setInterval(() => {
      const service = this.services.get(serviceId);
      if (service) {
        const timeSinceHeartbeat = Date.now() - new Date(service.lastHeartbeat).getTime();
        if (timeSinceHeartbeat > interval * 2) {
          service.state = SERVICE_STATES.UNHEALTHY;
          this.emit(EVENTS.SERVICE_UNHEALTHY, { serviceId, service });
        }
      }
    }, interval);

    this.heartbeatTimers.set(serviceId, timer);
    this._resetDeregisterTimer(serviceId);
  }

  /**
   * Reset deregister timer
   * @private
   */
  _resetDeregisterTimer(serviceId) {
    if (this.deregisterTimers.has(serviceId)) {
      clearTimeout(this.deregisterTimers.get(serviceId));
    }

    const deregisterAfter = this.config.deregisterAfter || 300000;
    const timer = setTimeout(() => {
      this.deregister(serviceId);
    }, deregisterAfter);

    this.deregisterTimers.set(serviceId, timer);
  }

  /**
   * Clear all timers for a service
   * @private
   */
  _clearTimers(serviceId) {
    if (this.heartbeatTimers.has(serviceId)) {
      clearInterval(this.heartbeatTimers.get(serviceId));
      this.heartbeatTimers.delete(serviceId);
    }

    if (this.deregisterTimers.has(serviceId)) {
      clearTimeout(this.deregisterTimers.get(serviceId));
      this.deregisterTimers.delete(serviceId);
    }
  }

  /**
   * Initialize persistence layer
   * @private
   */
  async _initializePersistence() {
    // Database persistence would be implemented here
    // For now, using in-memory storage
  }

  /**
   * Persist service to database
   * @private
   */
  async _persistService(service) {
    // Database persistence would be implemented here
  }

  /**
   * Remove service from database
   * @private
   */
  async _removePersistedService(serviceId) {
    // Database removal would be implemented here
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    for (const serviceId of this.services.keys()) {
      this._clearTimers(serviceId);
    }
    this.services.clear();
    this.removeAllListeners();
  }
}

module.exports = ServiceRegistry;