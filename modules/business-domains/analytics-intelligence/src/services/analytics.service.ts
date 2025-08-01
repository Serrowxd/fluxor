/**
 * Analytics Service
 * Handles KPIs, dashboards, and real-time metrics
 */

import {
  KPI,
  Dashboard,
  DashboardWidget,
  AnalyticsQuery,
  AnalyticsResult,
  PerformanceMetrics,
  TimeRange
} from '../types';

export class AnalyticsService {
  private database: any;
  private cache: any;
  private eventBus: any;
  private kpiCache: Map<string, KPI> = new Map();
  private dashboards: Map<string, Dashboard> = new Map();

  constructor(database: any, cache: any, eventBus: any) {
    this.database = database;
    this.cache = cache;
    this.eventBus = eventBus;
  }

  /**
   * Calculate and update key performance indicators
   */
  async calculateDailyKPIs(): Promise<KPI[]> {
    const kpis: KPI[] = [];

    try {
      // Calculate inventory KPIs
      const inventoryKPIs = await this.calculateInventoryKPIs();
      kpis.push(...inventoryKPIs);

      // Calculate sales KPIs
      const salesKPIs = await this.calculateSalesKPIs();
      kpis.push(...salesKPIs);

      // Calculate operational KPIs
      const operationalKPIs = await this.calculateOperationalKPIs();
      kpis.push(...operationalKPIs);

      // Cache KPIs
      for (const kpi of kpis) {
        this.kpiCache.set(kpi.id, kpi);
        await this.cache.set(`kpi:${kpi.id}`, kpi, 3600); // 1 hour TTL
      }

      // Emit event
      await this.eventBus.emit('KPIsCalculated', { kpis, timestamp: new Date() });

      return kpis;
    } catch (error) {
      console.error('Error calculating daily KPIs:', error);
      throw error;
    }
  }

  /**
   * Calculate inventory-specific KPIs
   */
  private async calculateInventoryKPIs(): Promise<KPI[]> {
    const kpis: KPI[] = [];

    // Inventory Turnover Ratio
    const turnoverData = await this.database.query(`
      SELECT 
        SUM(sold_quantity * unit_cost) / AVG(inventory_value) as turnover_ratio
      FROM inventory_metrics
      WHERE date >= NOW() - INTERVAL '30 days'
    `);

    const currentTurnover = turnoverData.rows[0]?.turnover_ratio || 0;
    const previousTurnover = await this.getPreviousKPIValue('inventory-turnover');
    
    kpis.push({
      id: 'inventory-turnover',
      name: 'Inventory Turnover Ratio',
      value: currentTurnover,
      unit: 'times',
      trend: this.calculateTrend(currentTurnover, previousTurnover),
      percentageChange: this.calculatePercentageChange(currentTurnover, previousTurnover),
      lastUpdated: new Date(),
      category: 'inventory'
    });

    // Stock-out Rate
    const stockoutData = await this.database.query(`
      SELECT 
        COUNT(DISTINCT product_id) * 100.0 / 
        (SELECT COUNT(DISTINCT id) FROM products WHERE active = true) as stockout_rate
      FROM inventory
      WHERE quantity = 0 AND warehouse_id IS NOT NULL
    `);

    const stockoutRate = stockoutData.rows[0]?.stockout_rate || 0;
    const previousStockoutRate = await this.getPreviousKPIValue('stockout-rate');

    kpis.push({
      id: 'stockout-rate',
      name: 'Stock-out Rate',
      value: stockoutRate,
      unit: '%',
      trend: this.calculateTrend(stockoutRate, previousStockoutRate, true), // Lower is better
      percentageChange: this.calculatePercentageChange(stockoutRate, previousStockoutRate),
      lastUpdated: new Date(),
      category: 'inventory'
    });

    // Dead Stock Value
    const deadStockData = await this.database.query(`
      SELECT 
        SUM(quantity * unit_cost) as dead_stock_value
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE i.last_movement_date < NOW() - INTERVAL '180 days'
        AND i.quantity > 0
    `);

    const deadStockValue = deadStockData.rows[0]?.dead_stock_value || 0;
    const previousDeadStock = await this.getPreviousKPIValue('dead-stock-value');

    kpis.push({
      id: 'dead-stock-value',
      name: 'Dead Stock Value',
      value: deadStockValue,
      unit: '$',
      trend: this.calculateTrend(deadStockValue, previousDeadStock, true), // Lower is better
      percentageChange: this.calculatePercentageChange(deadStockValue, previousDeadStock),
      lastUpdated: new Date(),
      category: 'inventory'
    });

    return kpis;
  }

  /**
   * Calculate sales-specific KPIs
   */
  private async calculateSalesKPIs(): Promise<KPI[]> {
    const kpis: KPI[] = [];

    // Average Order Value
    const aovData = await this.database.query(`
      SELECT 
        AVG(total_amount) as aov
      FROM orders
      WHERE status = 'completed'
        AND created_at >= NOW() - INTERVAL '30 days'
    `);

    const currentAOV = aovData.rows[0]?.aov || 0;
    const previousAOV = await this.getPreviousKPIValue('average-order-value');

    kpis.push({
      id: 'average-order-value',
      name: 'Average Order Value',
      value: currentAOV,
      unit: '$',
      trend: this.calculateTrend(currentAOV, previousAOV),
      percentageChange: this.calculatePercentageChange(currentAOV, previousAOV),
      lastUpdated: new Date(),
      category: 'sales'
    });

    // Order Fill Rate
    const fillRateData = await this.database.query(`
      SELECT 
        COUNT(CASE WHEN fully_fulfilled = true THEN 1 END) * 100.0 / COUNT(*) as fill_rate
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);

    const fillRate = fillRateData.rows[0]?.fill_rate || 0;
    const previousFillRate = await this.getPreviousKPIValue('order-fill-rate');

    kpis.push({
      id: 'order-fill-rate',
      name: 'Order Fill Rate',
      value: fillRate,
      unit: '%',
      trend: this.calculateTrend(fillRate, previousFillRate),
      percentageChange: this.calculatePercentageChange(fillRate, previousFillRate),
      lastUpdated: new Date(),
      category: 'sales'
    });

    return kpis;
  }

  /**
   * Calculate operational KPIs
   */
  private async calculateOperationalKPIs(): Promise<KPI[]> {
    const kpis: KPI[] = [];

    // Average Lead Time
    const leadTimeData = await this.database.query(`
      SELECT 
        AVG(EXTRACT(epoch FROM (received_at - ordered_at)) / 86400) as avg_lead_time
      FROM purchase_orders
      WHERE status = 'received'
        AND received_at >= NOW() - INTERVAL '90 days'
    `);

    const avgLeadTime = leadTimeData.rows[0]?.avg_lead_time || 0;
    const previousLeadTime = await this.getPreviousKPIValue('average-lead-time');

    kpis.push({
      id: 'average-lead-time',
      name: 'Average Lead Time',
      value: avgLeadTime,
      unit: 'days',
      trend: this.calculateTrend(avgLeadTime, previousLeadTime, true), // Lower is better
      percentageChange: this.calculatePercentageChange(avgLeadTime, previousLeadTime),
      lastUpdated: new Date(),
      category: 'operations'
    });

    // Warehouse Utilization
    const utilizationData = await this.database.query(`
      SELECT 
        AVG(used_capacity * 100.0 / total_capacity) as utilization_rate
      FROM warehouse_metrics
      WHERE date = CURRENT_DATE
    `);

    const utilization = utilizationData.rows[0]?.utilization_rate || 0;
    const previousUtilization = await this.getPreviousKPIValue('warehouse-utilization');

    kpis.push({
      id: 'warehouse-utilization',
      name: 'Warehouse Utilization',
      value: utilization,
      unit: '%',
      trend: this.calculateTrend(utilization, previousUtilization),
      percentageChange: this.calculatePercentageChange(utilization, previousUtilization),
      lastUpdated: new Date(),
      category: 'operations'
    });

    return kpis;
  }

  /**
   * Get specific KPI by ID
   */
  async getKPI(kpiId: string): Promise<KPI | null> {
    // Check cache first
    if (this.kpiCache.has(kpiId)) {
      return this.kpiCache.get(kpiId)!;
    }

    // Check Redis cache
    const cached = await this.cache.get(`kpi:${kpiId}`);
    if (cached) {
      return cached;
    }

    // Recalculate if not found
    await this.calculateDailyKPIs();
    return this.kpiCache.get(kpiId) || null;
  }

  /**
   * Get all KPIs for a category
   */
  async getKPIsByCategory(category: string): Promise<KPI[]> {
    const allKPIs = Array.from(this.kpiCache.values());
    return allKPIs.filter(kpi => kpi.category === category);
  }

  /**
   * Create or update a dashboard
   */
  async saveDashboard(dashboard: Dashboard): Promise<Dashboard> {
    try {
      const query = `
        INSERT INTO dashboards (id, name, widgets, created_by, is_default)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE
        SET name = $2, widgets = $3, last_modified = NOW()
        RETURNING *
      `;

      const result = await this.database.query(query, [
        dashboard.id,
        dashboard.name,
        JSON.stringify(dashboard.widgets),
        dashboard.createdBy,
        dashboard.isDefault
      ]);

      const saved = result.rows[0];
      const savedDashboard = {
        ...saved,
        widgets: JSON.parse(saved.widgets)
      };

      this.dashboards.set(saved.id, savedDashboard);
      await this.cache.set(`dashboard:${saved.id}`, savedDashboard, 3600);

      return savedDashboard;
    } catch (error) {
      console.error('Error saving dashboard:', error);
      throw error;
    }
  }

  /**
   * Get dashboard by ID
   */
  async getDashboard(dashboardId: string): Promise<Dashboard | null> {
    // Check memory cache
    if (this.dashboards.has(dashboardId)) {
      return this.dashboards.get(dashboardId)!;
    }

    // Check Redis cache
    const cached = await this.cache.get(`dashboard:${dashboardId}`);
    if (cached) {
      return cached;
    }

    // Query database
    const result = await this.database.query(
      'SELECT * FROM dashboards WHERE id = $1',
      [dashboardId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const dashboard = {
      ...result.rows[0],
      widgets: JSON.parse(result.rows[0].widgets)
    };

    this.dashboards.set(dashboardId, dashboard);
    await this.cache.set(`dashboard:${dashboardId}`, dashboard, 3600);

    return dashboard;
  }

  /**
   * Execute an analytics query
   */
  async executeQuery(query: AnalyticsQuery): Promise<AnalyticsResult> {
    const startTime = Date.now();
    
    try {
      // Build SQL query from analytics query
      const sql = this.buildSQLFromAnalyticsQuery(query);
      const result = await this.database.query(sql);

      const executionTime = Date.now() - startTime;

      return {
        data: result.rows,
        metadata: {
          totalRows: result.rows.length,
          executionTime,
          query
        }
      };
    } catch (error) {
      console.error('Error executing analytics query:', error);
      throw error;
    }
  }

  /**
   * Get performance metrics summary
   */
  async getPerformanceMetrics(timeRange?: TimeRange): Promise<PerformanceMetrics> {
    const metrics = await Promise.all([
      this.getKPI('inventory-turnover'),
      this.getKPI('stockout-rate'),
      this.getKPI('dead-stock-value'),
      this.getKPI('order-fill-rate'),
      this.getKPI('average-lead-time')
    ]);

    const [turnover, stockout, deadStock, fillRate, leadTime] = metrics;

    // Calculate additional metrics
    const costPerOrder = await this.calculateCostPerOrder(timeRange);
    const forecastAccuracy = await this.calculateForecastAccuracy(timeRange);

    return {
      inventoryTurnover: turnover?.value || 0,
      stockoutRate: stockout?.value || 0,
      overStockRate: (deadStock?.value || 0) > 100000 ? 15 : 5, // Simplified calculation
      orderFillRate: fillRate?.value || 0,
      averageLeadTime: leadTime?.value || 0,
      forecastAccuracy,
      costPerOrder
    };
  }

  /**
   * Update real-time metrics based on events
   */
  async updateRealTimeMetrics(event: any): Promise<void> {
    const { type, data } = event;

    switch (type) {
      case 'InventoryUpdated':
        await this.updateInventoryMetrics(data);
        break;
      case 'OrderCompleted':
        await this.updateOrderMetrics(data);
        break;
      default:
        // Handle other event types
        break;
    }

    // Emit updated metrics
    await this.eventBus.emit('MetricsUpdated', {
      type,
      timestamp: new Date()
    });
  }

  /**
   * Update order-related metrics
   */
  async updateOrderMetrics(orderData: any): Promise<void> {
    // Update order count
    await this.cache.increment('metrics:daily:order_count');
    
    // Update revenue
    await this.cache.incrementBy('metrics:daily:revenue', orderData.totalAmount);
    
    // Update average order value
    const orderCount = await this.cache.get('metrics:daily:order_count') || 0;
    const totalRevenue = await this.cache.get('metrics:daily:revenue') || 0;
    const aov = orderCount > 0 ? totalRevenue / orderCount : 0;
    
    await this.cache.set('metrics:daily:aov', aov);
  }

  /**
   * Update inventory-related metrics
   */
  private async updateInventoryMetrics(data: any): Promise<void> {
    // Update inventory value
    const { productId, warehouseId, quantityChange, unitCost } = data;
    const valueChange = quantityChange * unitCost;
    
    await this.cache.incrementBy(
      `metrics:inventory:value:${warehouseId}`,
      valueChange
    );
  }

  /**
   * Helper method to build SQL from analytics query
   */
  private buildSQLFromAnalyticsQuery(query: AnalyticsQuery): string {
    // This is a simplified implementation
    let sql = 'SELECT ';
    
    // Add metrics
    sql += query.metrics.join(', ');
    
    // Add dimensions if any
    if (query.dimensions && query.dimensions.length > 0) {
      sql += ', ' + query.dimensions.join(', ');
    }
    
    sql += ' FROM analytics_data WHERE 1=1';
    
    // Add filters
    if (query.filters) {
      for (const filter of query.filters) {
        sql += ` AND ${filter.field} ${filter.operator} ${this.formatValue(filter.value)}`;
      }
    }
    
    // Add group by
    if (query.groupBy && query.groupBy.length > 0) {
      sql += ' GROUP BY ' + query.groupBy.join(', ');
    }
    
    // Add order by
    if (query.orderBy && query.orderBy.length > 0) {
      sql += ' ORDER BY ' + query.orderBy
        .map(o => `${o.field} ${o.direction}`)
        .join(', ');
    }
    
    // Add limit
    if (query.limit) {
      sql += ` LIMIT ${query.limit}`;
    }
    
    return sql;
  }

  /**
   * Helper method to format SQL values
   */
  private formatValue(value: any): string {
    if (typeof value === 'string') {
      return `'${value}'`;
    }
    if (Array.isArray(value)) {
      return `(${value.map(v => this.formatValue(v)).join(', ')})`;
    }
    return String(value);
  }

  /**
   * Helper method to calculate trend
   */
  private calculateTrend(current: number, previous: number, lowerIsBetter = false): 'up' | 'down' | 'stable' {
    const threshold = 0.01; // 1% threshold for stability
    const change = (current - previous) / (previous || 1);
    
    if (Math.abs(change) < threshold) {
      return 'stable';
    }
    
    if (lowerIsBetter) {
      return change > 0 ? 'down' : 'up';
    }
    
    return change > 0 ? 'up' : 'down';
  }

  /**
   * Helper method to calculate percentage change
   */
  private calculatePercentageChange(current: number, previous: number): number {
    if (previous === 0) {
      return current > 0 ? 100 : 0;
    }
    return ((current - previous) / previous) * 100;
  }

  /**
   * Helper method to get previous KPI value
   */
  private async getPreviousKPIValue(kpiId: string): Promise<number> {
    const result = await this.database.query(
      `SELECT value FROM kpi_history 
       WHERE kpi_id = $1 
       ORDER BY timestamp DESC 
       LIMIT 1 OFFSET 1`,
      [kpiId]
    );
    
    return result.rows[0]?.value || 0;
  }

  /**
   * Helper method to calculate cost per order
   */
  private async calculateCostPerOrder(timeRange?: TimeRange): Promise<number> {
    const query = `
      SELECT 
        SUM(fulfillment_cost + shipping_cost) / COUNT(*) as cost_per_order
      FROM orders
      WHERE status = 'completed'
        ${timeRange ? `AND created_at BETWEEN $1 AND $2` : ''}
    `;
    
    const params = timeRange ? [timeRange.start, timeRange.end] : [];
    const result = await this.database.query(query, params);
    
    return result.rows[0]?.cost_per_order || 0;
  }

  /**
   * Helper method to calculate forecast accuracy
   */
  private async calculateForecastAccuracy(timeRange?: TimeRange): Promise<number> {
    const query = `
      SELECT 
        AVG(1 - ABS(forecasted - actual) / NULLIF(actual, 0)) * 100 as accuracy
      FROM forecast_accuracy
      WHERE 1=1
        ${timeRange ? `AND date BETWEEN $1 AND $2` : ''}
    `;
    
    const params = timeRange ? [timeRange.start, timeRange.end] : [];
    const result = await this.database.query(query, params);
    
    return result.rows[0]?.accuracy || 85; // Default to 85% if no data
  }

  isReady(): boolean {
    return true;
  }
}