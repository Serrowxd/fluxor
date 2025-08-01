/**
 * Circuit Breaker - Fault tolerance pattern implementation
 * @module service-registry/services/CircuitBreaker
 */

const EventEmitter = require('events');
const { CIRCUIT_BREAKER_STATES, EVENTS } = require('../constants');

class CircuitBreaker extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      failureThreshold: config.failureThreshold || 5,
      successThreshold: config.successThreshold || 2,
      timeout: config.timeout || 60000,
      resetTimeout: config.resetTimeout || 30000,
      ...config
    };
    
    this.breakers = new Map();
  }

  /**
   * Get or create circuit breaker for a service
   * @param {string} serviceId - Service ID
   * @returns {Object} Circuit breaker state
   */
  getBreaker(serviceId) {
    if (!this.breakers.has(serviceId)) {
      this.breakers.set(serviceId, this._createBreaker());
    }
    return this.breakers.get(serviceId);
  }

  /**
   * Execute function with circuit breaker protection
   * @param {string} serviceId - Service ID
   * @param {Function} fn - Function to execute
   * @returns {Promise<any>} Function result
   */
  async execute(serviceId, fn) {
    const breaker = this.getBreaker(serviceId);

    if (breaker.state === CIRCUIT_BREAKER_STATES.OPEN) {
      if (Date.now() < breaker.nextAttempt) {
        throw new Error(`Circuit breaker is OPEN for service ${serviceId}`);
      }
      // Try half-open state
      breaker.state = CIRCUIT_BREAKER_STATES.HALF_OPEN;
      this.emit(EVENTS.CIRCUIT_BREAKER_HALF_OPEN, { serviceId });
    }

    try {
      const result = await Promise.race([
        fn(),
        this._timeout(this.config.timeout)
      ]);

      this._onSuccess(serviceId, breaker);
      return result;
    } catch (error) {
      this._onFailure(serviceId, breaker);
      throw error;
    }
  }

  /**
   * Manually trip the circuit breaker
   * @param {string} serviceId - Service ID
   */
  trip(serviceId) {
    const breaker = this.getBreaker(serviceId);
    breaker.state = CIRCUIT_BREAKER_STATES.OPEN;
    breaker.failures = this.config.failureThreshold;
    breaker.nextAttempt = Date.now() + this.config.resetTimeout;
    this.emit(EVENTS.CIRCUIT_BREAKER_OPEN, { serviceId });
  }

  /**
   * Manually reset the circuit breaker
   * @param {string} serviceId - Service ID
   */
  reset(serviceId) {
    const breaker = this.getBreaker(serviceId);
    breaker.state = CIRCUIT_BREAKER_STATES.CLOSED;
    breaker.failures = 0;
    breaker.successes = 0;
    breaker.lastFailure = null;
    breaker.nextAttempt = null;
    this.emit(EVENTS.CIRCUIT_BREAKER_CLOSED, { serviceId });
  }

  /**
   * Get circuit breaker state
   * @param {string} serviceId - Service ID
   * @returns {Object} Circuit breaker state
   */
  getState(serviceId) {
    const breaker = this.getBreaker(serviceId);
    return {
      state: breaker.state,
      failures: breaker.failures,
      successes: breaker.successes,
      lastFailure: breaker.lastFailure,
      nextAttempt: breaker.nextAttempt
    };
  }

  /**
   * Get all circuit breaker states
   * @returns {Object} All states
   */
  getAllStates() {
    const states = {};
    for (const [serviceId, breaker] of this.breakers) {
      states[serviceId] = {
        state: breaker.state,
        failures: breaker.failures,
        successes: breaker.successes,
        lastFailure: breaker.lastFailure,
        nextAttempt: breaker.nextAttempt
      };
    }
    return states;
  }

  /**
   * Create new circuit breaker instance
   * @private
   */
  _createBreaker() {
    return {
      state: CIRCUIT_BREAKER_STATES.CLOSED,
      failures: 0,
      successes: 0,
      lastFailure: null,
      nextAttempt: null
    };
  }

  /**
   * Handle successful execution
   * @private
   */
  _onSuccess(serviceId, breaker) {
    breaker.failures = 0;

    if (breaker.state === CIRCUIT_BREAKER_STATES.HALF_OPEN) {
      breaker.successes++;
      if (breaker.successes >= this.config.successThreshold) {
        breaker.state = CIRCUIT_BREAKER_STATES.CLOSED;
        breaker.successes = 0;
        this.emit(EVENTS.CIRCUIT_BREAKER_CLOSED, { serviceId });
      }
    }
  }

  /**
   * Handle failed execution
   * @private
   */
  _onFailure(serviceId, breaker) {
    breaker.failures++;
    breaker.lastFailure = new Date();

    if (breaker.state === CIRCUIT_BREAKER_STATES.HALF_OPEN) {
      breaker.state = CIRCUIT_BREAKER_STATES.OPEN;
      breaker.nextAttempt = Date.now() + this.config.resetTimeout;
      this.emit(EVENTS.CIRCUIT_BREAKER_OPEN, { serviceId });
    } else if (breaker.failures >= this.config.failureThreshold) {
      breaker.state = CIRCUIT_BREAKER_STATES.OPEN;
      breaker.nextAttempt = Date.now() + this.config.resetTimeout;
      this.emit(EVENTS.CIRCUIT_BREAKER_OPEN, { serviceId });
    }
  }

  /**
   * Create timeout promise
   * @private
   */
  _timeout(ms) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Circuit breaker timeout')), ms);
    });
  }

  /**
   * Get statistics
   * @returns {Object} Circuit breaker statistics
   */
  getStats() {
    const stats = {
      total: this.breakers.size,
      byState: {
        [CIRCUIT_BREAKER_STATES.CLOSED]: 0,
        [CIRCUIT_BREAKER_STATES.OPEN]: 0,
        [CIRCUIT_BREAKER_STATES.HALF_OPEN]: 0
      }
    };

    for (const breaker of this.breakers.values()) {
      stats.byState[breaker.state]++;
    }

    return stats;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.breakers.clear();
    this.removeAllListeners();
  }
}

module.exports = CircuitBreaker;