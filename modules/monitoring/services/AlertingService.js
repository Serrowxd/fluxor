/**
 * Alerting Service - Alert rule evaluation and notification
 * @module monitoring/services/AlertingService
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const { ALERT_SEVERITY, ALERT_STATUS } = require('../constants');

class AlertingService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.rules = new Map();
    this.alerts = new Map();
    this.notifiers = [];
    this.evaluationInterval = config.alerting?.evaluationInterval || 60000;
    this.evaluationTimer = null;
    
    this._initializeNotifiers();
    this._startEvaluation();
  }

  /**
   * Register alert rule
   * @param {Object} rule - Alert rule definition
   * @returns {string} Rule ID
   */
  registerRule(rule) {
    const ruleId = rule.id || uuidv4();
    const fullRule = {
      id: ruleId,
      name: rule.name,
      expr: rule.expr,
      duration: rule.duration || 0,
      severity: rule.severity || ALERT_SEVERITY.WARNING,
      labels: rule.labels || {},
      annotations: rule.annotations || {},
      enabled: rule.enabled !== false,
      evaluateFn: rule.evaluateFn || this._createEvaluator(rule.expr),
      state: {
        firing: false,
        pendingSince: null,
        lastEvaluation: null,
        value: null
      }
    };
    
    this.rules.set(ruleId, fullRule);
    this.emit('rule.registered', { ruleId, rule: fullRule });
    
    return ruleId;
  }

  /**
   * Unregister alert rule
   * @param {string} ruleId - Rule ID
   */
  unregisterRule(ruleId) {
    const rule = this.rules.get(ruleId);
    if (!rule) return;
    
    // Resolve any active alerts for this rule
    for (const [alertId, alert] of this.alerts) {
      if (alert.ruleId === ruleId && alert.status === ALERT_STATUS.FIRING) {
        this._resolveAlert(alertId, 'Rule removed');
      }
    }
    
    this.rules.delete(ruleId);
    this.emit('rule.unregistered', { ruleId });
  }

  /**
   * Evaluate all rules
   * @returns {Promise<Object>} Evaluation results
   */
  async evaluateRules() {
    const results = {
      evaluated: 0,
      firing: 0,
      errors: []
    };
    
    for (const [ruleId, rule] of this.rules) {
      if (!rule.enabled) continue;
      
      try {
        await this._evaluateRule(rule);
        results.evaluated++;
        if (rule.state.firing) {
          results.firing++;
        }
      } catch (error) {
        results.errors.push({
          ruleId,
          error: error.message
        });
      }
    }
    
    this.emit('rules.evaluated', results);
    return results;
  }

  /**
   * Get active alerts
   * @param {Object} filter - Filter criteria
   * @returns {Array} Active alerts
   */
  getActiveAlerts(filter = {}) {
    let alerts = Array.from(this.alerts.values());
    
    if (filter.status) {
      alerts = alerts.filter(a => a.status === filter.status);
    }
    
    if (filter.severity) {
      alerts = alerts.filter(a => a.severity === filter.severity);
    }
    
    if (filter.ruleId) {
      alerts = alerts.filter(a => a.ruleId === filter.ruleId);
    }
    
    return alerts;
  }

  /**
   * Get alert by ID
   * @param {string} alertId - Alert ID
   * @returns {Object|null} Alert
   */
  getAlert(alertId) {
    return this.alerts.get(alertId) || null;
  }

  /**
   * Acknowledge alert
   * @param {string} alertId - Alert ID
   * @param {Object} ack - Acknowledgement data
   * @returns {boolean} Success
   */
  acknowledgeAlert(alertId, ack = {}) {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status !== ALERT_STATUS.FIRING) {
      return false;
    }
    
    alert.acknowledged = {
      at: new Date(),
      by: ack.by || 'system',
      comment: ack.comment
    };
    
    this.emit('alert.acknowledged', { alertId, alert, ack });
    return true;
  }

  /**
   * Add notifier
   * @param {Object} notifier - Notifier instance
   */
  addNotifier(notifier) {
    this.notifiers.push(notifier);
  }

  /**
   * Remove notifier
   * @param {Object} notifier - Notifier instance
   */
  removeNotifier(notifier) {
    const index = this.notifiers.indexOf(notifier);
    if (index !== -1) {
      this.notifiers.splice(index, 1);
    }
  }

  /**
   * Test alert notification
   * @param {Object} testAlert - Test alert data
   * @returns {Promise<Object>} Test results
   */
  async testNotification(testAlert = {}) {
    const alert = {
      id: 'test-' + uuidv4(),
      name: testAlert.name || 'Test Alert',
      severity: testAlert.severity || ALERT_SEVERITY.INFO,
      status: ALERT_STATUS.FIRING,
      message: testAlert.message || 'This is a test alert',
      labels: testAlert.labels || {},
      annotations: testAlert.annotations || {},
      startsAt: new Date(),
      source: 'test'
    };
    
    const results = await this._notifyAlert(alert);
    return { alert, results };
  }

  /**
   * Evaluate single rule
   * @private
   */
  async _evaluateRule(rule) {
    const startTime = Date.now();
    
    try {
      // Evaluate rule expression
      const result = await rule.evaluateFn();
      const value = typeof result === 'object' ? result.value : result;
      const shouldFire = typeof result === 'object' ? result.fire : Boolean(result);
      
      rule.state.lastEvaluation = new Date();
      rule.state.value = value;
      
      if (shouldFire) {
        // Check if already firing
        if (rule.state.firing) {
          // Update existing alert
          this._updateFiringAlert(rule, value);
        } else {
          // Check duration requirement
          if (rule.duration > 0) {
            if (!rule.state.pendingSince) {
              rule.state.pendingSince = new Date();
            } else {
              const pendingDuration = Date.now() - rule.state.pendingSince.getTime();
              if (pendingDuration >= rule.duration) {
                this._fireAlert(rule, value);
                rule.state.pendingSince = null;
              }
            }
          } else {
            // Fire immediately
            this._fireAlert(rule, value);
          }
        }
      } else {
        // Should not fire
        if (rule.state.firing) {
          this._resolveAlert(rule.state.alertId, 'Condition resolved');
        }
        rule.state.pendingSince = null;
      }
      
      this.emit('rule.evaluated', {
        ruleId: rule.id,
        duration: Date.now() - startTime,
        firing: rule.state.firing,
        value
      });
    } catch (error) {
      this.emit('rule.error', {
        ruleId: rule.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Fire alert
   * @private
   */
  _fireAlert(rule, value) {
    const alertId = uuidv4();
    const alert = {
      id: alertId,
      ruleId: rule.id,
      name: rule.name,
      severity: rule.severity,
      status: ALERT_STATUS.FIRING,
      message: this._formatMessage(rule, value),
      labels: { ...rule.labels },
      annotations: { ...rule.annotations },
      startsAt: new Date(),
      value,
      source: 'rule'
    };
    
    this.alerts.set(alertId, alert);
    rule.state.firing = true;
    rule.state.alertId = alertId;
    
    this.emit('alert.firing', { alertId, alert });
    this._notifyAlert(alert);
  }

  /**
   * Update firing alert
   * @private
   */
  _updateFiringAlert(rule, value) {
    const alert = this.alerts.get(rule.state.alertId);
    if (alert) {
      alert.value = value;
      alert.lastUpdate = new Date();
      alert.message = this._formatMessage(rule, value);
    }
  }

  /**
   * Resolve alert
   * @private
   */
  _resolveAlert(alertId, reason) {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status !== ALERT_STATUS.FIRING) {
      return;
    }
    
    alert.status = ALERT_STATUS.RESOLVED;
    alert.endsAt = new Date();
    alert.resolvedReason = reason;
    
    // Find and update rule state
    for (const rule of this.rules.values()) {
      if (rule.state.alertId === alertId) {
        rule.state.firing = false;
        rule.state.alertId = null;
        break;
      }
    }
    
    this.emit('alert.resolved', { alertId, alert, reason });
    this._notifyAlert(alert);
  }

  /**
   * Format alert message
   * @private
   */
  _formatMessage(rule, value) {
    let message = rule.annotations.message || `Alert ${rule.name} is firing`;
    
    // Replace template variables
    message = message.replace(/\{\{\.Value\}\}/g, value);
    message = message.replace(/\{\{\.Labels\.(\w+)\}\}/g, (match, label) => {
      return rule.labels[label] || '';
    });
    
    return message;
  }

  /**
   * Notify alert
   * @private
   */
  async _notifyAlert(alert) {
    const results = [];
    
    for (const notifier of this.notifiers) {
      try {
        await notifier.notify(alert);
        results.push({ notifier: notifier.name, success: true });
      } catch (error) {
        results.push({ 
          notifier: notifier.name, 
          success: false, 
          error: error.message 
        });
        
        this.emit('notification.error', {
          alert,
          notifier: notifier.name,
          error: error.message
        });
      }
    }
    
    return results;
  }

  /**
   * Create evaluator function
   * @private
   */
  _createEvaluator(expr) {
    // Simple expression evaluator
    // In real implementation, would use proper expression parser
    return async () => {
      // Placeholder implementation
      return Math.random() > 0.8; // 20% chance to fire
    };
  }

  /**
   * Initialize notifiers
   * @private
   */
  _initializeNotifiers() {
    const notifierConfigs = this.config.alerting?.notifiers || [];
    
    for (const config of notifierConfigs) {
      if (!config.enabled) continue;
      
      const notifier = this._createNotifier(config);
      if (notifier) {
        this.notifiers.push(notifier);
      }
    }
  }

  /**
   * Create notifier
   * @private
   */
  _createNotifier(config) {
    switch (config.type) {
      case 'webhook':
        return new WebhookNotifier(config);
      
      case 'email':
        return new EmailNotifier(config);
      
      default:
        return null;
    }
  }

  /**
   * Start rule evaluation
   * @private
   */
  _startEvaluation() {
    if (!this.config.alerting?.enabled) {
      return;
    }
    
    this.evaluationTimer = setInterval(() => {
      this.evaluateRules();
    }, this.evaluationInterval);
    
    // Initial evaluation
    this.evaluateRules();
  }

  /**
   * Get alerting statistics
   * @returns {Object} Statistics
   */
  getStatistics() {
    const stats = {
      rules: {
        total: this.rules.size,
        enabled: 0,
        firing: 0
      },
      alerts: {
        total: this.alerts.size,
        firing: 0,
        resolved: 0,
        acknowledged: 0
      },
      notifiers: this.notifiers.length
    };
    
    for (const rule of this.rules.values()) {
      if (rule.enabled) stats.rules.enabled++;
      if (rule.state.firing) stats.rules.firing++;
    }
    
    for (const alert of this.alerts.values()) {
      if (alert.status === ALERT_STATUS.FIRING) {
        stats.alerts.firing++;
        if (alert.acknowledged) {
          stats.alerts.acknowledged++;
        }
      } else if (alert.status === ALERT_STATUS.RESOLVED) {
        stats.alerts.resolved++;
      }
    }
    
    return stats;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
    }
    
    this.rules.clear();
    this.alerts.clear();
    this.notifiers = [];
    this.removeAllListeners();
  }
}

/**
 * Webhook notifier
 */
class WebhookNotifier {
  constructor(config) {
    this.name = 'webhook';
    this.config = config;
  }

  async notify(alert) {
    // In real implementation, would send HTTP request
    const payload = {
      alert: {
        id: alert.id,
        name: alert.name,
        severity: alert.severity,
        status: alert.status,
        message: alert.message,
        labels: alert.labels,
        annotations: alert.annotations,
        startsAt: alert.startsAt,
        endsAt: alert.endsAt
      }
    };
    
    // await axios.post(this.config.url, payload, {
    //   headers: this.config.headers
    // });
  }
}

/**
 * Email notifier
 */
class EmailNotifier {
  constructor(config) {
    this.name = 'email';
    this.config = config;
  }

  async notify(alert) {
    // In real implementation, would send email
    const subject = `[${alert.severity.toUpperCase()}] ${alert.name}`;
    const body = `
Alert: ${alert.name}
Status: ${alert.status}
Severity: ${alert.severity}
Message: ${alert.message}
Started: ${alert.startsAt}
${alert.endsAt ? `Ended: ${alert.endsAt}` : ''}

Labels: ${JSON.stringify(alert.labels, null, 2)}
    `;
    
    // await sendEmail({
    //   from: this.config.from,
    //   to: this.config.to,
    //   subject,
    //   text: body
    // });
  }
}

module.exports = AlertingService;