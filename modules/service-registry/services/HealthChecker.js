/**
 * Health Checker - Service health monitoring
 * @module service-registry/services/HealthChecker
 */

const EventEmitter = require('events');
const axios = require('axios');
const net = require('net');
const { exec } = require('child_process');
const { promisify } = require('util');
const { HEALTH_CHECK_TYPES, EVENTS } = require('../constants');

const execAsync = promisify(exec);

class HealthChecker extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.checkIntervals = new Map();
    this.healthStatus = new Map();
  }

  /**
   * Start health checks for a service
   * @param {Object} service - Service definition
   * @param {Object} checkConfig - Health check configuration
   */
  startHealthChecks(service, checkConfig) {
    if (this.checkIntervals.has(service.id)) {
      this.stopHealthChecks(service.id);
    }

    const interval = setInterval(async () => {
      const status = await this.checkHealth(service, checkConfig);
      this.healthStatus.set(service.id, status);
      
      if (!status.healthy) {
        this.emit(EVENTS.SERVICE_UNHEALTHY, { serviceId: service.id, status });
      } else {
        this.emit(EVENTS.SERVICE_HEALTHY, { serviceId: service.id, status });
      }
    }, checkConfig.interval || this.config.interval);

    this.checkIntervals.set(service.id, interval);
    
    // Perform initial health check
    this.checkHealth(service, checkConfig).then(status => {
      this.healthStatus.set(service.id, status);
    });
  }

  /**
   * Stop health checks for a service
   * @param {string} serviceId - Service ID
   */
  stopHealthChecks(serviceId) {
    if (this.checkIntervals.has(serviceId)) {
      clearInterval(this.checkIntervals.get(serviceId));
      this.checkIntervals.delete(serviceId);
      this.healthStatus.delete(serviceId);
    }
  }

  /**
   * Perform health check on a service
   * @param {Object} service - Service definition
   * @param {Object} checkConfig - Health check configuration
   * @returns {Promise<Object>} Health status
   */
  async checkHealth(service, checkConfig) {
    const startTime = Date.now();
    const checks = {};
    let healthy = true;
    let error = null;

    try {
      for (const check of checkConfig.checks || []) {
        const checkResult = await this._performCheck(service, check);
        checks[check.name] = checkResult;
        if (!checkResult.success) {
          healthy = false;
        }
      }
    } catch (err) {
      healthy = false;
      error = err.message;
    }

    const responseTime = Date.now() - startTime;

    return {
      serviceId: service.id,
      healthy,
      responseTime,
      checks,
      checkedAt: new Date(),
      error
    };
  }

  /**
   * Get health status for a service
   * @param {string} serviceId - Service ID
   * @returns {Object|null} Health status
   */
  getHealthStatus(serviceId) {
    return this.healthStatus.get(serviceId) || null;
  }

  /**
   * Get all health statuses
   * @returns {Array<Object>} All health statuses
   */
  getAllHealthStatuses() {
    return Array.from(this.healthStatus.values());
  }

  /**
   * Perform individual health check
   * @private
   */
  async _performCheck(service, check) {
    const timeout = check.timeout || this.config.timeout;
    const retries = check.retries || this.config.retries || 3;
    const retryDelay = check.retryDelay || this.config.retryDelay || 1000;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await this._executeCheck(service, check, timeout);
        return { success: true, ...result };
      } catch (error) {
        if (attempt === retries) {
          return { success: false, error: error.message };
        }
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  /**
   * Execute specific check type
   * @private
   */
  async _executeCheck(service, check, timeout) {
    switch (check.type) {
      case HEALTH_CHECK_TYPES.HTTP:
        return await this._httpCheck(service, check, timeout);
      
      case HEALTH_CHECK_TYPES.TCP:
        return await this._tcpCheck(service, check, timeout);
      
      case HEALTH_CHECK_TYPES.EXEC:
        return await this._execCheck(service, check, timeout);
      
      case HEALTH_CHECK_TYPES.TTL:
        return await this._ttlCheck(service, check);
      
      default:
        throw new Error(`Unknown health check type: ${check.type}`);
    }
  }

  /**
   * HTTP health check
   * @private
   */
  async _httpCheck(service, check, timeout) {
    const url = `${service.protocol || 'http'}://${service.host}:${service.port}${check.path || '/health'}`;
    const response = await axios.get(url, {
      timeout,
      validateStatus: status => status < 500
    });

    return {
      statusCode: response.status,
      responseTime: response.headers['x-response-time'],
      data: response.data
    };
  }

  /**
   * TCP health check
   * @private
   */
  async _tcpCheck(service, check, timeout) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const startTime = Date.now();

      socket.setTimeout(timeout);

      socket.connect(service.port, service.host, () => {
        const connectTime = Date.now() - startTime;
        socket.destroy();
        resolve({ connectTime });
      });

      socket.on('error', (err) => {
        socket.destroy();
        reject(err);
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      });
    });
  }

  /**
   * Execute command health check
   * @private
   */
  async _execCheck(service, check, timeout) {
    const { stdout, stderr } = await execAsync(check.command, {
      timeout,
      env: {
        ...process.env,
        SERVICE_HOST: service.host,
        SERVICE_PORT: service.port,
        SERVICE_ID: service.id
      }
    });

    if (stderr) {
      throw new Error(stderr);
    }

    return { output: stdout.trim() };
  }

  /**
   * TTL health check
   * @private
   */
  async _ttlCheck(service, check) {
    const lastHeartbeat = this.healthStatus.get(service.id)?.lastHeartbeat;
    if (!lastHeartbeat) {
      return { ttlExpired: true };
    }

    const elapsed = Date.now() - new Date(lastHeartbeat).getTime();
    const ttlExpired = elapsed > (check.ttl || 30000);

    return { ttlExpired, elapsed };
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    for (const serviceId of this.checkIntervals.keys()) {
      this.stopHealthChecks(serviceId);
    }
    this.removeAllListeners();
  }
}

module.exports = HealthChecker;