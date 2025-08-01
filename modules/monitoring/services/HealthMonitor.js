/**
 * Health Monitor - System health monitoring
 * @module monitoring/services/HealthMonitor
 */

const EventEmitter = require('events');
const os = require('os');
const { HEALTH_STATUS } = require('../constants');

class HealthMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.checks = new Map();
    this.results = new Map();
    this.checkTimers = new Map();
    
    this._initializeDefaultChecks();
  }

  /**
   * Register a health check
   * @param {string} name - Check name
   * @param {Function} checkFn - Check function
   * @param {Object} options - Check options
   */
  registerCheck(name, checkFn, options = {}) {
    const check = {
      name,
      checkFn,
      interval: options.interval || 30000,
      timeout: options.timeout || 5000,
      critical: options.critical !== false,
      enabled: options.enabled !== false,
      tags: options.tags || []
    };
    
    this.checks.set(name, check);
    
    if (check.enabled) {
      this._startCheck(name);
    }
    
    this.emit('check.registered', { name, check });
  }

  /**
   * Unregister a health check
   * @param {string} name - Check name
   */
  unregisterCheck(name) {
    this._stopCheck(name);
    this.checks.delete(name);
    this.results.delete(name);
    
    this.emit('check.unregistered', { name });
  }

  /**
   * Run health check manually
   * @param {string} name - Check name
   * @returns {Promise<Object>} Check result
   */
  async runCheck(name) {
    const check = this.checks.get(name);
    if (!check) {
      throw new Error(`Health check '${name}' not found`);
    }
    
    const startTime = Date.now();
    const result = {
      name,
      healthy: false,
      status: 'checking',
      responseTime: 0,
      checkedAt: new Date()
    };
    
    try {
      // Run check with timeout
      const checkPromise = check.checkFn();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Check timeout')), check.timeout);
      });
      
      const checkResult = await Promise.race([checkPromise, timeoutPromise]);
      
      result.responseTime = Date.now() - startTime;
      
      if (typeof checkResult === 'boolean') {
        result.healthy = checkResult;
        result.status = checkResult ? 'healthy' : 'unhealthy';
      } else if (typeof checkResult === 'object') {
        result.healthy = checkResult.healthy !== false;
        result.status = checkResult.status || (result.healthy ? 'healthy' : 'unhealthy');
        result.details = checkResult.details || checkResult;
      }
    } catch (error) {
      result.responseTime = Date.now() - startTime;
      result.healthy = false;
      result.status = 'error';
      result.error = error.message;
    }
    
    // Store result
    this.results.set(name, result);
    
    // Emit event if status changed
    const previousResult = this.results.get(name);
    if (!previousResult || previousResult.healthy !== result.healthy) {
      this.emit('health.changed', { name, result, previous: previousResult });
    }
    
    return result;
  }

  /**
   * Get overall health status
   * @returns {Object} Overall health
   */
  getHealth() {
    const results = Array.from(this.results.values());
    const criticalChecks = results.filter(r => {
      const check = this.checks.get(r.name);
      return check && check.critical;
    });
    
    let status = HEALTH_STATUS.HEALTHY;
    
    // Check critical checks first
    const unhealthyCritical = criticalChecks.some(r => !r.healthy);
    if (unhealthyCritical) {
      status = HEALTH_STATUS.UNHEALTHY;
    } else {
      // Check non-critical checks
      const unhealthyCount = results.filter(r => !r.healthy).length;
      if (unhealthyCount > 0) {
        status = HEALTH_STATUS.DEGRADED;
      }
    }
    
    return {
      status,
      timestamp: new Date(),
      checks: results.length,
      healthy: results.filter(r => r.healthy).length,
      unhealthy: results.filter(r => !r.healthy).length
    };
  }

  /**
   * Get detailed health status
   * @returns {Object} Detailed health
   */
  getDetailedHealth() {
    const overall = this.getHealth();
    const checks = {};
    
    for (const [name, result] of this.results) {
      checks[name] = { ...result };
    }
    
    return {
      ...overall,
      details: checks
    };
  }

  /**
   * Start all health checks
   */
  startAllChecks() {
    for (const [name, check] of this.checks) {
      if (check.enabled && !this.checkTimers.has(name)) {
        this._startCheck(name);
      }
    }
  }

  /**
   * Stop all health checks
   */
  stopAllChecks() {
    for (const name of this.checks.keys()) {
      this._stopCheck(name);
    }
  }

  /**
   * Initialize default health checks
   * @private
   */
  _initializeDefaultChecks() {
    const healthConfig = this.config.health || {};
    
    // System checks
    this.registerCheck('system', async () => {
      const cpuUsage = process.cpuUsage();
      const memUsage = process.memoryUsage();
      const uptime = process.uptime();
      
      return {
        healthy: true,
        details: {
          uptime,
          cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system
          },
          memory: {
            rss: memUsage.rss,
            heapTotal: memUsage.heapTotal,
            heapUsed: memUsage.heapUsed,
            external: memUsage.external
          },
          load: os.loadavg(),
          freemem: os.freemem(),
          totalmem: os.totalmem()
        }
      };
    }, { interval: 30000 });
    
    // Database check (if configured)
    if (healthConfig.checks?.database?.enabled) {
      this.registerCheck('database', async () => {
        // Placeholder for database check
        // In real implementation, would check database connection
        return { healthy: true, responseTime: Math.random() * 100 };
      }, healthConfig.checks.database);
    }
    
    // Redis check (if configured)
    if (healthConfig.checks?.redis?.enabled) {
      this.registerCheck('redis', async () => {
        // Placeholder for Redis check
        // In real implementation, would check Redis connection
        return { healthy: true, responseTime: Math.random() * 50 };
      }, healthConfig.checks.redis);
    }
    
    // Disk space check
    if (healthConfig.checks?.disk?.enabled) {
      this.registerCheck('disk', async () => {
        const threshold = healthConfig.checks.disk.threshold || 0.9;
        // Placeholder for disk check
        // In real implementation, would check disk usage
        const usage = 0.5; // 50% usage
        return {
          healthy: usage < threshold,
          details: {
            usage,
            threshold,
            free: os.freemem(),
            total: os.totalmem()
          }
        };
      }, healthConfig.checks.disk);
    }
    
    // Memory check
    if (healthConfig.checks?.memory?.enabled) {
      this.registerCheck('memory', async () => {
        const threshold = healthConfig.checks.memory.threshold || 0.85;
        const memUsage = process.memoryUsage();
        const totalMem = os.totalmem();
        const usage = memUsage.rss / totalMem;
        
        return {
          healthy: usage < threshold,
          details: {
            usage,
            threshold,
            rss: memUsage.rss,
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal
          }
        };
      }, healthConfig.checks.memory);
    }
  }

  /**
   * Start a health check
   * @private
   */
  _startCheck(name) {
    const check = this.checks.get(name);
    if (!check) return;
    
    // Run initial check
    this.runCheck(name);
    
    // Set up interval
    const timer = setInterval(() => {
      this.runCheck(name);
    }, check.interval);
    
    this.checkTimers.set(name, timer);
  }

  /**
   * Stop a health check
   * @private
   */
  _stopCheck(name) {
    const timer = this.checkTimers.get(name);
    if (timer) {
      clearInterval(timer);
      this.checkTimers.delete(name);
    }
  }

  /**
   * Get health check statistics
   * @returns {Object} Statistics
   */
  getStatistics() {
    const stats = {
      totalChecks: this.checks.size,
      enabledChecks: 0,
      totalRuns: 0,
      averageResponseTime: 0,
      checkStats: {}
    };
    
    let totalResponseTime = 0;
    let responseCount = 0;
    
    for (const [name, check] of this.checks) {
      if (check.enabled) stats.enabledChecks++;
      
      const result = this.results.get(name);
      if (result) {
        stats.totalRuns++;
        if (result.responseTime) {
          totalResponseTime += result.responseTime;
          responseCount++;
        }
        
        stats.checkStats[name] = {
          enabled: check.enabled,
          critical: check.critical,
          lastRun: result.checkedAt,
          healthy: result.healthy,
          responseTime: result.responseTime
        };
      }
    }
    
    if (responseCount > 0) {
      stats.averageResponseTime = totalResponseTime / responseCount;
    }
    
    return stats;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopAllChecks();
    this.checks.clear();
    this.results.clear();
    this.removeAllListeners();
  }
}

module.exports = HealthMonitor;