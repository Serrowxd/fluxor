/**
 * Metrics Collector - Prometheus-style metrics collection
 * @module monitoring/services/MetricsCollector
 */

const EventEmitter = require('events');
const { METRIC_TYPES, DEFAULT_METRICS } = require('../constants');

class MetricsCollector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.metrics = new Map();
    this.defaultLabels = config.metrics?.defaultLabels || {};
    this.aggregationInterval = config.metrics?.aggregationInterval || 60000;
    
    this._initializeDefaultMetrics();
    this._startAggregation();
  }

  /**
   * Register a metric
   * @param {Object} definition - Metric definition
   * @returns {Object} Metric instance
   */
  registerMetric(definition) {
    const { name, type, description, labels = [], buckets, quantiles, unit } = definition;
    
    if (this.metrics.has(name)) {
      return this.metrics.get(name);
    }

    const metric = {
      name,
      type,
      description,
      labels,
      unit,
      values: new Map(),
      aggregatedValues: new Map()
    };

    switch (type) {
      case METRIC_TYPES.HISTOGRAM:
        metric.buckets = buckets || [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
        metric.sum = new Map();
        metric.count = new Map();
        break;
      
      case METRIC_TYPES.SUMMARY:
        metric.quantiles = quantiles || [0.01, 0.05, 0.5, 0.95, 0.99];
        metric.sum = new Map();
        metric.count = new Map();
        metric.values = new Map();
        break;
    }

    this.metrics.set(name, metric);
    this.emit('metric.registered', { name, definition });
    
    return metric;
  }

  /**
   * Increment a counter
   * @param {string} name - Metric name
   * @param {number} value - Increment value
   * @param {Object} labels - Metric labels
   */
  inc(name, value = 1, labels = {}) {
    const metric = this._getOrCreateMetric(name, METRIC_TYPES.COUNTER);
    const labelKey = this._getLabelKey(labels);
    
    const current = metric.values.get(labelKey) || 0;
    metric.values.set(labelKey, current + value);
    
    this.emit('metric.updated', { name, type: 'inc', value, labels });
  }

  /**
   * Set a gauge value
   * @param {string} name - Metric name
   * @param {number} value - Gauge value
   * @param {Object} labels - Metric labels
   */
  set(name, value, labels = {}) {
    const metric = this._getOrCreateMetric(name, METRIC_TYPES.GAUGE);
    const labelKey = this._getLabelKey(labels);
    
    metric.values.set(labelKey, value);
    
    this.emit('metric.updated', { name, type: 'set', value, labels });
  }

  /**
   * Observe a value for histogram
   * @param {string} name - Metric name
   * @param {number} value - Observed value
   * @param {Object} labels - Metric labels
   */
  observe(name, value, labels = {}) {
    const metric = this._getOrCreateMetric(name, METRIC_TYPES.HISTOGRAM);
    const labelKey = this._getLabelKey(labels);
    
    // Update buckets
    if (!metric.count.has(labelKey)) {
      metric.count.set(labelKey, 0);
      metric.sum.set(labelKey, 0);
      
      // Initialize bucket counts
      for (const bucket of metric.buckets) {
        const bucketKey = `${labelKey}:le:${bucket}`;
        metric.values.set(bucketKey, 0);
      }
      // +Inf bucket
      metric.values.set(`${labelKey}:le:+Inf`, 0);
    }
    
    // Update bucket counts
    for (const bucket of metric.buckets) {
      if (value <= bucket) {
        const bucketKey = `${labelKey}:le:${bucket}`;
        metric.values.set(bucketKey, metric.values.get(bucketKey) + 1);
      }
    }
    metric.values.set(`${labelKey}:le:+Inf`, metric.values.get(`${labelKey}:le:+Inf`) + 1);
    
    // Update sum and count
    metric.count.set(labelKey, metric.count.get(labelKey) + 1);
    metric.sum.set(labelKey, metric.sum.get(labelKey) + value);
    
    this.emit('metric.updated', { name, type: 'observe', value, labels });
  }

  /**
   * Start a timer for histogram observation
   * @param {string} name - Metric name
   * @param {Object} labels - Metric labels
   * @returns {Function} End timer function
   */
  startTimer(name, labels = {}) {
    const start = process.hrtime.bigint();
    
    return () => {
      const end = process.hrtime.bigint();
      const duration = Number(end - start) / 1e9; // Convert to seconds
      this.observe(name, duration, labels);
      return duration;
    };
  }

  /**
   * Get metric value
   * @param {string} name - Metric name
   * @param {Object} labels - Metric labels
   * @returns {number|null} Metric value
   */
  getValue(name, labels = {}) {
    const metric = this.metrics.get(name);
    if (!metric) {
      return null;
    }

    const labelKey = this._getLabelKey(labels);
    return metric.values.get(labelKey) || 0;
  }

  /**
   * Get all metrics in Prometheus format
   * @returns {string} Prometheus format metrics
   */
  getPrometheusMetrics() {
    const lines = [];
    
    for (const [name, metric] of this.metrics) {
      // Add help and type comments
      if (metric.description) {
        lines.push(`# HELP ${name} ${metric.description}`);
      }
      lines.push(`# TYPE ${name} ${metric.type}`);
      
      switch (metric.type) {
        case METRIC_TYPES.COUNTER:
        case METRIC_TYPES.GAUGE:
          for (const [labelKey, value] of metric.values) {
            const labels = this._parseLabelKey(labelKey);
            const labelStr = this._formatLabels({ ...this.defaultLabels, ...labels });
            lines.push(`${name}${labelStr} ${value}`);
          }
          break;
        
        case METRIC_TYPES.HISTOGRAM:
          // Output buckets
          const bucketKeys = new Map();
          for (const [key, value] of metric.values) {
            if (key.includes(':le:')) {
              const [labelKey, , bucket] = key.split(':le:');
              if (!bucketKeys.has(labelKey)) {
                bucketKeys.set(labelKey, []);
              }
              bucketKeys.get(labelKey).push({ bucket, count: value });
            }
          }
          
          for (const [labelKey, buckets] of bucketKeys) {
            const labels = this._parseLabelKey(labelKey);
            const baseLabels = { ...this.defaultLabels, ...labels };
            
            // Sort buckets and output
            buckets.sort((a, b) => {
              if (a.bucket === '+Inf') return 1;
              if (b.bucket === '+Inf') return -1;
              return parseFloat(a.bucket) - parseFloat(b.bucket);
            });
            
            for (const { bucket, count } of buckets) {
              const bucketLabels = { ...baseLabels, le: bucket };
              const labelStr = this._formatLabels(bucketLabels);
              lines.push(`${name}_bucket${labelStr} ${count}`);
            }
            
            // Output sum and count
            const labelStr = this._formatLabels(baseLabels);
            lines.push(`${name}_sum${labelStr} ${metric.sum.get(labelKey) || 0}`);
            lines.push(`${name}_count${labelStr} ${metric.count.get(labelKey) || 0}`);
          }
          break;
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Get all metrics as JSON
   * @returns {Object} Metrics data
   */
  getMetricsJSON() {
    const result = {
      timestamp: new Date().toISOString(),
      metrics: {}
    };
    
    for (const [name, metric] of this.metrics) {
      result.metrics[name] = {
        type: metric.type,
        description: metric.description,
        unit: metric.unit,
        values: {}
      };
      
      switch (metric.type) {
        case METRIC_TYPES.COUNTER:
        case METRIC_TYPES.GAUGE:
          for (const [labelKey, value] of metric.values) {
            const labels = this._parseLabelKey(labelKey);
            const key = JSON.stringify({ ...this.defaultLabels, ...labels });
            result.metrics[name].values[key] = value;
          }
          break;
        
        case METRIC_TYPES.HISTOGRAM:
          for (const [labelKey, ] of metric.count) {
            const labels = this._parseLabelKey(labelKey);
            const key = JSON.stringify({ ...this.defaultLabels, ...labels });
            
            const buckets = {};
            for (const bucket of metric.buckets) {
              buckets[bucket] = metric.values.get(`${labelKey}:le:${bucket}`) || 0;
            }
            
            result.metrics[name].values[key] = {
              buckets,
              count: metric.count.get(labelKey),
              sum: metric.sum.get(labelKey)
            };
          }
          break;
      }
    }
    
    return result;
  }

  /**
   * Reset all metrics
   */
  reset() {
    for (const metric of this.metrics.values()) {
      metric.values.clear();
      if (metric.sum) metric.sum.clear();
      if (metric.count) metric.count.clear();
      if (metric.aggregatedValues) metric.aggregatedValues.clear();
    }
    
    this.emit('metrics.reset');
  }

  /**
   * Initialize default metrics
   * @private
   */
  _initializeDefaultMetrics() {
    for (const [name, definition] of Object.entries(DEFAULT_METRICS)) {
      this.registerMetric({ name, ...definition });
    }
  }

  /**
   * Start metrics aggregation
   * @private
   */
  _startAggregation() {
    if (this.aggregationInterval <= 0) {
      return;
    }
    
    this.aggregationTimer = setInterval(() => {
      this._aggregateMetrics();
    }, this.aggregationInterval);
  }

  /**
   * Aggregate metrics
   * @private
   */
  _aggregateMetrics() {
    for (const [name, metric] of this.metrics) {
      if (metric.type === METRIC_TYPES.GAUGE) {
        // For gauges, calculate average
        for (const [labelKey, value] of metric.values) {
          const current = metric.aggregatedValues.get(labelKey) || { sum: 0, count: 0 };
          current.sum += value;
          current.count += 1;
          current.avg = current.sum / current.count;
          metric.aggregatedValues.set(labelKey, current);
        }
      }
    }
    
    this.emit('metrics.aggregated');
  }

  /**
   * Get or create metric
   * @private
   */
  _getOrCreateMetric(name, type) {
    if (!this.metrics.has(name)) {
      return this.registerMetric({ name, type });
    }
    
    const metric = this.metrics.get(name);
    if (metric.type !== type) {
      throw new Error(`Metric ${name} already exists with type ${metric.type}`);
    }
    
    return metric;
  }

  /**
   * Get label key
   * @private
   */
  _getLabelKey(labels) {
    const sortedLabels = Object.keys(labels).sort();
    return sortedLabels.map(key => `${key}:${labels[key]}`).join(',');
  }

  /**
   * Parse label key
   * @private
   */
  _parseLabelKey(labelKey) {
    if (!labelKey) return {};
    
    const labels = {};
    const pairs = labelKey.split(',');
    for (const pair of pairs) {
      const [key, value] = pair.split(':');
      if (key && value !== undefined) {
        labels[key] = value;
      }
    }
    
    return labels;
  }

  /**
   * Format labels for Prometheus
   * @private
   */
  _formatLabels(labels) {
    const pairs = Object.entries(labels)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}="${value}"`);
    
    return pairs.length > 0 ? `{${pairs.join(',')}}` : '';
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
    }
    this.metrics.clear();
    this.removeAllListeners();
  }
}

module.exports = MetricsCollector;