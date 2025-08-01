/**
 * Insights Service
 * Handles anomaly detection and business insights
 */

import {
  Anomaly,
  AnomalyMetric,
  TimeRange
} from '../types';
import { AnalyticsService } from './analytics.service';

interface AnomalyDetectionConfig {
  sensitivity: 'low' | 'medium' | 'high';
  lookbackPeriod: number; // days
  thresholds: {
    inventory: { zScore: number; percentageDeviation: number };
    sales: { zScore: number; percentageDeviation: number };
    demand: { zScore: number; percentageDeviation: number };
    price: { zScore: number; percentageDeviation: number };
  };
}

interface StatisticalMetrics {
  mean: number;
  stdDev: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
}

export class InsightsService {
  private database: any;
  private analyticsService: AnalyticsService;
  private eventBus: any;
  private anomalyCache: Map<string, Anomaly> = new Map();
  private detectionConfig: AnomalyDetectionConfig;

  constructor(database: any, analyticsService: AnalyticsService, eventBus: any) {
    this.database = database;
    this.analyticsService = analyticsService;
    this.eventBus = eventBus;
    
    // Default configuration
    this.detectionConfig = {
      sensitivity: 'medium',
      lookbackPeriod: 30,
      thresholds: {
        inventory: { zScore: 2.5, percentageDeviation: 30 },
        sales: { zScore: 3.0, percentageDeviation: 40 },
        demand: { zScore: 2.5, percentageDeviation: 35 },
        price: { zScore: 2.0, percentageDeviation: 20 }
      }
    };
  }

  /**
   * Run comprehensive anomaly detection
   */
  async runAnomalyDetection(): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    try {
      // Detect inventory anomalies
      const inventoryAnomalies = await this.detectInventoryAnomalies();
      anomalies.push(...inventoryAnomalies);

      // Detect sales anomalies
      const salesAnomalies = await this.detectSalesAnomalies();
      anomalies.push(...salesAnomalies);

      // Detect demand anomalies
      const demandAnomalies = await this.detectDemandAnomalies();
      anomalies.push(...demandAnomalies);

      // Detect price anomalies
      const priceAnomalies = await this.detectPriceAnomalies();
      anomalies.push(...priceAnomalies);

      // Store anomalies
      for (const anomaly of anomalies) {
        this.anomalyCache.set(anomaly.id, anomaly);
        await this.storeAnomaly(anomaly);
      }

      // Emit event
      if (anomalies.length > 0) {
        await this.eventBus.emit('AnomaliesDetected', {
          count: anomalies.length,
          critical: anomalies.filter(a => a.severity === 'critical').length,
          timestamp: new Date()
        });
      }

      return anomalies;
    } catch (error) {
      console.error('Error during anomaly detection:', error);
      throw error;
    }
  }

  /**
   * Detect inventory anomalies
   */
  private async detectInventoryAnomalies(): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Query for unusual inventory levels
    const query = `
      WITH inventory_stats AS (
        SELECT 
          i.product_id,
          i.warehouse_id,
          p.name as product_name,
          w.name as warehouse_name,
          i.quantity as current_quantity,
          AVG(ih.quantity) as avg_quantity,
          STDDEV(ih.quantity) as stddev_quantity,
          MIN(ih.quantity) as min_quantity,
          MAX(ih.quantity) as max_quantity
        FROM inventory i
        JOIN products p ON i.product_id = p.id
        JOIN warehouses w ON i.warehouse_id = w.id
        LEFT JOIN inventory_history ih ON 
          ih.product_id = i.product_id AND 
          ih.warehouse_id = i.warehouse_id AND
          ih.date >= NOW() - INTERVAL '${this.detectionConfig.lookbackPeriod} days'
        GROUP BY i.product_id, i.warehouse_id, p.name, w.name, i.quantity
      )
      SELECT *
      FROM inventory_stats
      WHERE stddev_quantity > 0
        AND (
          ABS(current_quantity - avg_quantity) / stddev_quantity > ${this.detectionConfig.thresholds.inventory.zScore}
          OR ABS(current_quantity - avg_quantity) / NULLIF(avg_quantity, 0) > ${this.detectionConfig.thresholds.inventory.percentageDeviation / 100}
        )
    `;

    const result = await this.database.query(query);

    for (const row of result.rows) {
      const metrics: AnomalyMetric[] = [
        {
          name: 'Current Inventory Level',
          expectedValue: row.avg_quantity,
          actualValue: row.current_quantity,
          deviation: row.current_quantity - row.avg_quantity,
          deviationPercentage: ((row.current_quantity - row.avg_quantity) / row.avg_quantity) * 100
        }
      ];

      const severity = this.calculateAnomalySeverity(
        row.current_quantity,
        row.avg_quantity,
        row.stddev_quantity,
        'inventory'
      );

      const suggestedActions = this.generateInventoryActions(
        row.current_quantity,
        row.avg_quantity,
        row.min_quantity,
        row.max_quantity
      );

      anomalies.push({
        id: `anomaly-inv-${Date.now()}-${row.product_id}`,
        type: 'inventory',
        severity,
        description: `Unusual inventory level detected for ${row.product_name} at ${row.warehouse_name}`,
        detectedAt: new Date(),
        affectedEntity: {
          type: 'product',
          id: row.product_id,
          name: row.product_name
        },
        metrics,
        suggestedActions,
        isResolved: false
      });
    }

    return anomalies;
  }

  /**
   * Detect sales anomalies
   */
  private async detectSalesAnomalies(): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    const query = `
      WITH daily_sales AS (
        SELECT 
          DATE(created_at) as sale_date,
          product_id,
          p.name as product_name,
          SUM(quantity) as daily_quantity,
          SUM(total_amount) as daily_revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        JOIN products p ON oi.product_id = p.id
        WHERE o.status = 'completed'
          AND o.created_at >= NOW() - INTERVAL '${this.detectionConfig.lookbackPeriod + 7} days'
        GROUP BY DATE(o.created_at), oi.product_id, p.name
      ),
      sales_stats AS (
        SELECT 
          product_id,
          product_name,
          AVG(daily_quantity) as avg_quantity,
          STDDEV(daily_quantity) as stddev_quantity,
          AVG(daily_revenue) as avg_revenue,
          STDDEV(daily_revenue) as stddev_revenue
        FROM daily_sales
        WHERE sale_date < CURRENT_DATE - INTERVAL '7 days'
        GROUP BY product_id, product_name
      ),
      recent_sales AS (
        SELECT 
          product_id,
          AVG(daily_quantity) as recent_avg_quantity,
          AVG(daily_revenue) as recent_avg_revenue
        FROM daily_sales
        WHERE sale_date >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY product_id
      )
      SELECT 
        ss.*,
        rs.recent_avg_quantity,
        rs.recent_avg_revenue
      FROM sales_stats ss
      JOIN recent_sales rs ON ss.product_id = rs.product_id
      WHERE ss.stddev_quantity > 0
        AND (
          ABS(rs.recent_avg_quantity - ss.avg_quantity) / ss.stddev_quantity > ${this.detectionConfig.thresholds.sales.zScore}
          OR ABS(rs.recent_avg_quantity - ss.avg_quantity) / NULLIF(ss.avg_quantity, 0) > ${this.detectionConfig.thresholds.sales.percentageDeviation / 100}
        )
    `;

    const result = await this.database.query(query);

    for (const row of result.rows) {
      const metrics: AnomalyMetric[] = [
        {
          name: 'Daily Sales Quantity',
          expectedValue: row.avg_quantity,
          actualValue: row.recent_avg_quantity,
          deviation: row.recent_avg_quantity - row.avg_quantity,
          deviationPercentage: ((row.recent_avg_quantity - row.avg_quantity) / row.avg_quantity) * 100
        },
        {
          name: 'Daily Revenue',
          expectedValue: row.avg_revenue,
          actualValue: row.recent_avg_revenue,
          deviation: row.recent_avg_revenue - row.avg_revenue,
          deviationPercentage: ((row.recent_avg_revenue - row.avg_revenue) / row.avg_revenue) * 100
        }
      ];

      const severity = this.calculateAnomalySeverity(
        row.recent_avg_quantity,
        row.avg_quantity,
        row.stddev_quantity,
        'sales'
      );

      const isIncrease = row.recent_avg_quantity > row.avg_quantity;
      const suggestedActions = this.generateSalesActions(isIncrease, metrics[0].deviationPercentage);

      anomalies.push({
        id: `anomaly-sales-${Date.now()}-${row.product_id}`,
        type: 'sales',
        severity,
        description: `Unusual sales ${isIncrease ? 'spike' : 'drop'} detected for ${row.product_name}`,
        detectedAt: new Date(),
        affectedEntity: {
          type: 'product',
          id: row.product_id,
          name: row.product_name
        },
        metrics,
        suggestedActions,
        isResolved: false
      });
    }

    return anomalies;
  }

  /**
   * Detect demand anomalies
   */
  private async detectDemandAnomalies(): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Compare actual demand vs forecasted demand
    const query = `
      WITH demand_comparison AS (
        SELECT 
          fa.product_id,
          p.name as product_name,
          fa.date,
          fa.forecasted,
          fa.actual,
          ABS(fa.forecasted - fa.actual) as absolute_error,
          ABS(fa.forecasted - fa.actual) / NULLIF(fa.actual, 0) as percentage_error
        FROM forecast_accuracy fa
        JOIN products p ON fa.product_id = p.id
        WHERE fa.date >= CURRENT_DATE - INTERVAL '7 days'
          AND fa.actual IS NOT NULL
      )
      SELECT 
        product_id,
        product_name,
        AVG(percentage_error) as avg_error,
        MAX(percentage_error) as max_error,
        COUNT(*) as error_count
      FROM demand_comparison
      GROUP BY product_id, product_name
      HAVING AVG(percentage_error) > ${this.detectionConfig.thresholds.demand.percentageDeviation / 100}
         OR MAX(percentage_error) > ${this.detectionConfig.thresholds.demand.percentageDeviation / 100 * 2}
    `;

    const result = await this.database.query(query);

    for (const row of result.rows) {
      const metrics: AnomalyMetric[] = [
        {
          name: 'Forecast Accuracy',
          expectedValue: 95, // Expected 95% accuracy
          actualValue: (1 - row.avg_error) * 100,
          deviation: row.avg_error * 100,
          deviationPercentage: row.avg_error * 100
        }
      ];

      const severity = row.max_error > 0.5 ? 'high' : 
                      row.avg_error > 0.3 ? 'medium' : 'low';

      const suggestedActions = [
        'Review and update forecast model parameters',
        'Check for recent market changes or events',
        'Analyze external factors affecting demand',
        'Consider adjusting safety stock levels'
      ];

      anomalies.push({
        id: `anomaly-demand-${Date.now()}-${row.product_id}`,
        type: 'demand',
        severity,
        description: `Significant forecast deviation detected for ${row.product_name}`,
        detectedAt: new Date(),
        affectedEntity: {
          type: 'product',
          id: row.product_id,
          name: row.product_name
        },
        metrics,
        suggestedActions,
        isResolved: false
      });
    }

    return anomalies;
  }

  /**
   * Detect price anomalies
   */
  private async detectPriceAnomalies(): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    const query = `
      WITH price_history AS (
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.unit_price as current_price,
          AVG(ph.price) as avg_price,
          STDDEV(ph.price) as stddev_price,
          MIN(ph.price) as min_price,
          MAX(ph.price) as max_price
        FROM products p
        LEFT JOIN price_history ph ON 
          ph.product_id = p.id AND
          ph.date >= NOW() - INTERVAL '${this.detectionConfig.lookbackPeriod} days'
        GROUP BY p.id, p.name, p.unit_price
        HAVING COUNT(ph.price) > 5
      )
      SELECT *
      FROM price_history
      WHERE stddev_price > 0
        AND (
          ABS(current_price - avg_price) / stddev_price > ${this.detectionConfig.thresholds.price.zScore}
          OR ABS(current_price - avg_price) / NULLIF(avg_price, 0) > ${this.detectionConfig.thresholds.price.percentageDeviation / 100}
        )
    `;

    const result = await this.database.query(query);

    for (const row of result.rows) {
      const metrics: AnomalyMetric[] = [
        {
          name: 'Product Price',
          expectedValue: row.avg_price,
          actualValue: row.current_price,
          deviation: row.current_price - row.avg_price,
          deviationPercentage: ((row.current_price - row.avg_price) / row.avg_price) * 100
        }
      ];

      const severity = this.calculateAnomalySeverity(
        row.current_price,
        row.avg_price,
        row.stddev_price,
        'price'
      );

      const isIncrease = row.current_price > row.avg_price;
      const suggestedActions = this.generatePriceActions(
        isIncrease,
        metrics[0].deviationPercentage,
        row.min_price,
        row.max_price
      );

      anomalies.push({
        id: `anomaly-price-${Date.now()}-${row.product_id}`,
        type: 'price',
        severity,
        description: `Unusual price ${isIncrease ? 'increase' : 'decrease'} detected for ${row.product_name}`,
        detectedAt: new Date(),
        affectedEntity: {
          type: 'product',
          id: row.product_id,
          name: row.product_name
        },
        metrics,
        suggestedActions,
        isResolved: false
      });
    }

    return anomalies;
  }

  /**
   * Detect anomalies in order patterns
   */
  async detectOrderAnomalies(orderEvent: any): Promise<void> {
    const { orderId, customerId, totalAmount, items } = orderEvent;

    try {
      // Check for unusual order size
      const sizeAnomaly = await this.checkOrderSizeAnomaly(customerId, totalAmount, items);
      if (sizeAnomaly) {
        await this.storeAnomaly(sizeAnomaly);
      }

      // Check for unusual product combinations
      const comboAnomaly = await this.checkProductCombinationAnomaly(items);
      if (comboAnomaly) {
        await this.storeAnomaly(comboAnomaly);
      }

      // Check for velocity anomalies
      const velocityAnomaly = await this.checkOrderVelocityAnomaly(customerId);
      if (velocityAnomaly) {
        await this.storeAnomaly(velocityAnomaly);
      }

    } catch (error) {
      console.error('Error detecting order anomalies:', error);
    }
  }

  /**
   * Get anomalies for a specific entity
   */
  async getAnomaliesByEntity(entityType: string, entityId: string): Promise<Anomaly[]> {
    const query = `
      SELECT * FROM anomalies
      WHERE affected_entity_type = $1
        AND affected_entity_id = $2
        AND is_resolved = false
      ORDER BY detected_at DESC
      LIMIT 50
    `;

    const result = await this.database.query(query, [entityType, entityId]);
    
    return result.rows.map(row => ({
      id: row.id,
      type: row.type,
      severity: row.severity,
      description: row.description,
      detectedAt: row.detected_at,
      affectedEntity: JSON.parse(row.affected_entity),
      metrics: JSON.parse(row.metrics),
      suggestedActions: JSON.parse(row.suggested_actions),
      isResolved: row.is_resolved
    }));
  }

  /**
   * Get recent anomalies
   */
  async getRecentAnomalies(limit = 100): Promise<Anomaly[]> {
    const query = `
      SELECT * FROM anomalies
      WHERE detected_at >= NOW() - INTERVAL '24 hours'
      ORDER BY 
        CASE severity 
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        detected_at DESC
      LIMIT $1
    `;

    const result = await this.database.query(query, [limit]);
    
    return result.rows.map(row => ({
      id: row.id,
      type: row.type,
      severity: row.severity,
      description: row.description,
      detectedAt: row.detected_at,
      affectedEntity: JSON.parse(row.affected_entity),
      metrics: JSON.parse(row.metrics),
      suggestedActions: JSON.parse(row.suggested_actions),
      isResolved: row.is_resolved
    }));
  }

  /**
   * Mark anomaly as resolved
   */
  async resolveAnomaly(anomalyId: string, resolution: string): Promise<void> {
    await this.database.query(
      `UPDATE anomalies 
       SET is_resolved = true, 
           resolution = $2,
           resolved_at = NOW()
       WHERE id = $1`,
      [anomalyId, resolution]
    );

    this.anomalyCache.delete(anomalyId);

    await this.eventBus.emit('AnomalyResolved', {
      anomalyId,
      resolution,
      timestamp: new Date()
    });
  }

  /**
   * Update detection configuration
   */
  updateDetectionConfig(config: Partial<AnomalyDetectionConfig>): void {
    this.detectionConfig = { ...this.detectionConfig, ...config };
  }

  /**
   * Helper methods
   */

  private calculateAnomalySeverity(
    actual: number,
    expected: number,
    stdDev: number,
    type: string
  ): 'low' | 'medium' | 'high' | 'critical' {
    const zScore = Math.abs((actual - expected) / stdDev);
    const percentageDeviation = Math.abs((actual - expected) / expected) * 100;
    const threshold = this.detectionConfig.thresholds[type];

    if (zScore > threshold.zScore * 2 || percentageDeviation > threshold.percentageDeviation * 2) {
      return 'critical';
    } else if (zScore > threshold.zScore * 1.5 || percentageDeviation > threshold.percentageDeviation * 1.5) {
      return 'high';
    } else if (zScore > threshold.zScore || percentageDeviation > threshold.percentageDeviation) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  private generateInventoryActions(
    current: number,
    average: number,
    min: number,
    max: number
  ): string[] {
    const actions: string[] = [];

    if (current < min * 0.5) {
      actions.push('URGENT: Reorder immediately to prevent stockout');
      actions.push('Consider expedited shipping from suppliers');
      actions.push('Check for supply chain disruptions');
    } else if (current < average * 0.7) {
      actions.push('Place reorder to restore normal inventory levels');
      actions.push('Review demand forecast for accuracy');
    } else if (current > max * 1.5) {
      actions.push('Review for potential overstock situation');
      actions.push('Consider promotional activities to reduce inventory');
      actions.push('Verify no duplicate orders were placed');
    } else if (current > average * 1.3) {
      actions.push('Monitor inventory levels closely');
      actions.push('Adjust reorder points if demand has decreased');
    }

    return actions;
  }

  private generateSalesActions(isIncrease: boolean, deviationPercentage: number): string[] {
    const actions: string[] = [];

    if (isIncrease) {
      actions.push('Ensure adequate inventory to meet increased demand');
      actions.push('Investigate cause of sales spike (promotion, trend, etc.)');
      if (deviationPercentage > 50) {
        actions.push('Consider increasing forecast for this product');
        actions.push('Alert warehouse to prepare for higher volume');
      }
    } else {
      actions.push('Review competitive pricing and market conditions');
      actions.push('Check for product quality issues or negative reviews');
      if (deviationPercentage < -50) {
        actions.push('Consider promotional activities to boost sales');
        actions.push('Evaluate product placement and visibility');
      }
    }

    return actions;
  }

  private generatePriceActions(
    isIncrease: boolean,
    deviationPercentage: number,
    minPrice: number,
    maxPrice: number
  ): string[] {
    const actions: string[] = [];

    if (isIncrease) {
      actions.push('Review competitor pricing for market alignment');
      actions.push('Analyze price elasticity impact on demand');
      if (deviationPercentage > 20) {
        actions.push('Consider gradual price adjustments');
        actions.push('Monitor customer feedback on pricing');
      }
    } else {
      actions.push('Verify pricing is not below cost');
      actions.push('Check for unauthorized discounts or errors');
      if (deviationPercentage < -20) {
        actions.push('Review margin impact of price reduction');
        actions.push('Ensure price matches intended promotions');
      }
    }

    return actions;
  }

  private async checkOrderSizeAnomaly(
    customerId: string,
    totalAmount: number,
    items: any[]
  ): Promise<Anomaly | null> {
    const stats = await this.getCustomerOrderStats(customerId);
    
    if (!stats || stats.orderCount < 5) {
      return null; // Not enough history
    }

    const zScore = (totalAmount - stats.avgAmount) / stats.stdDevAmount;
    
    if (Math.abs(zScore) > 3) {
      return {
        id: `anomaly-order-size-${Date.now()}`,
        type: 'sales',
        severity: Math.abs(zScore) > 4 ? 'high' : 'medium',
        description: `Unusual order size from customer ${customerId}`,
        detectedAt: new Date(),
        affectedEntity: {
          type: 'customer',
          id: customerId,
          name: `Customer ${customerId}`
        },
        metrics: [{
          name: 'Order Amount',
          expectedValue: stats.avgAmount,
          actualValue: totalAmount,
          deviation: totalAmount - stats.avgAmount,
          deviationPercentage: ((totalAmount - stats.avgAmount) / stats.avgAmount) * 100
        }],
        suggestedActions: [
          'Verify order authenticity',
          'Check for potential fraud',
          'Contact customer if necessary'
        ],
        isResolved: false
      };
    }

    return null;
  }

  private async checkProductCombinationAnomaly(items: any[]): Promise<Anomaly | null> {
    // Simplified implementation - check for unusual product combinations
    // In production, would use association rules or ML models
    return null;
  }

  private async checkOrderVelocityAnomaly(customerId: string): Promise<Anomaly | null> {
    // Check if customer is ordering too frequently
    const recentOrders = await this.database.query(
      `SELECT COUNT(*) as order_count
       FROM orders
       WHERE customer_id = $1
         AND created_at >= NOW() - INTERVAL '24 hours'`,
      [customerId]
    );

    if (recentOrders.rows[0].order_count > 5) {
      return {
        id: `anomaly-velocity-${Date.now()}`,
        type: 'sales',
        severity: 'medium',
        description: `High order frequency detected for customer ${customerId}`,
        detectedAt: new Date(),
        affectedEntity: {
          type: 'customer',
          id: customerId,
          name: `Customer ${customerId}`
        },
        metrics: [{
          name: 'Orders in 24h',
          expectedValue: 1,
          actualValue: recentOrders.rows[0].order_count,
          deviation: recentOrders.rows[0].order_count - 1,
          deviationPercentage: ((recentOrders.rows[0].order_count - 1) / 1) * 100
        }],
        suggestedActions: [
          'Review orders for potential abuse',
          'Check inventory allocation',
          'Consider order limits if necessary'
        ],
        isResolved: false
      };
    }

    return null;
  }

  private async getCustomerOrderStats(customerId: string): Promise<any> {
    const query = `
      SELECT 
        COUNT(*) as order_count,
        AVG(total_amount) as avg_amount,
        STDDEV(total_amount) as stddev_amount
      FROM orders
      WHERE customer_id = $1
        AND status = 'completed'
        AND created_at >= NOW() - INTERVAL '6 months'
    `;

    const result = await this.database.query(query, [customerId]);
    return {
      orderCount: result.rows[0].order_count,
      avgAmount: result.rows[0].avg_amount || 0,
      stdDevAmount: result.rows[0].stddev_amount || 1
    };
  }

  private async storeAnomaly(anomaly: Anomaly): Promise<void> {
    await this.database.query(
      `INSERT INTO anomalies (
        id, type, severity, description, detected_at,
        affected_entity_type, affected_entity_id, affected_entity,
        metrics, suggested_actions, is_resolved
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO NOTHING`,
      [
        anomaly.id,
        anomaly.type,
        anomaly.severity,
        anomaly.description,
        anomaly.detectedAt,
        anomaly.affectedEntity.type,
        anomaly.affectedEntity.id,
        JSON.stringify(anomaly.affectedEntity),
        JSON.stringify(anomaly.metrics),
        JSON.stringify(anomaly.suggestedActions),
        anomaly.isResolved
      ]
    );
  }

  isReady(): boolean {
    return true;
  }
}