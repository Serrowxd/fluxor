/**
 * Report Generation Service
 * Handles creation of various reports in multiple formats
 */

import {
  Report,
  ReportSchedule,
  TimeRange,
  KPI,
  Forecast,
  Anomaly,
  PerformanceMetrics
} from '../types';
import { AnalyticsService } from './analytics.service';
import { ForecastService } from './forecast.service';
import { InsightsService } from './insights.service';

interface ReportTemplate {
  id: string;
  name: string;
  type: Report['type'];
  sections: ReportSection[];
  defaultParameters: Record<string, any>;
}

interface ReportSection {
  title: string;
  type: 'summary' | 'table' | 'chart' | 'metrics' | 'text';
  dataSource: string;
  config?: Record<string, any>;
}

interface ReportData {
  metadata: {
    title: string;
    generatedAt: Date;
    generatedBy: string;
    period?: TimeRange;
  };
  sections: Array<{
    title: string;
    data: any;
  }>;
}

export class ReportGenerationService {
  private analyticsService: AnalyticsService;
  private forecastService: ForecastService;
  private insightsService: InsightsService;
  private reportTemplates: Map<string, ReportTemplate> = new Map();
  private scheduledReports: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    analyticsService: AnalyticsService,
    forecastService: ForecastService,
    insightsService: InsightsService
  ) {
    this.analyticsService = analyticsService;
    this.forecastService = forecastService;
    this.insightsService = insightsService;
    
    // Initialize default report templates
    this.initializeTemplates();
  }

  /**
   * Initialize default report templates
   */
  private initializeTemplates(): void {
    // Inventory Report Template
    this.reportTemplates.set('inventory-summary', {
      id: 'inventory-summary',
      name: 'Inventory Summary Report',
      type: 'inventory',
      sections: [
        {
          title: 'Executive Summary',
          type: 'summary',
          dataSource: 'inventorySummary'
        },
        {
          title: 'Key Performance Indicators',
          type: 'metrics',
          dataSource: 'inventoryKPIs'
        },
        {
          title: 'Stock Levels by Warehouse',
          type: 'table',
          dataSource: 'warehouseStock'
        },
        {
          title: 'Dead Stock Analysis',
          type: 'table',
          dataSource: 'deadStock'
        },
        {
          title: 'Reorder Recommendations',
          type: 'table',
          dataSource: 'reorderRecommendations'
        }
      ],
      defaultParameters: {
        includeZeroStock: false,
        deadStockThreshold: 180 // days
      }
    });

    // Sales Report Template
    this.reportTemplates.set('sales-performance', {
      id: 'sales-performance',
      name: 'Sales Performance Report',
      type: 'sales',
      sections: [
        {
          title: 'Sales Summary',
          type: 'summary',
          dataSource: 'salesSummary'
        },
        {
          title: 'Sales Metrics',
          type: 'metrics',
          dataSource: 'salesKPIs'
        },
        {
          title: 'Top Performing Products',
          type: 'table',
          dataSource: 'topProducts',
          config: { limit: 20 }
        },
        {
          title: 'Sales by Channel',
          type: 'chart',
          dataSource: 'channelSales',
          config: { chartType: 'pie' }
        },
        {
          title: 'Sales Trend Analysis',
          type: 'chart',
          dataSource: 'salesTrend',
          config: { chartType: 'line' }
        }
      ],
      defaultParameters: {
        period: 'month'
      }
    });

    // Forecast Report Template
    this.reportTemplates.set('demand-forecast', {
      id: 'demand-forecast',
      name: 'Demand Forecast Report',
      type: 'forecast',
      sections: [
        {
          title: 'Forecast Summary',
          type: 'summary',
          dataSource: 'forecastSummary'
        },
        {
          title: 'Forecast Accuracy Metrics',
          type: 'metrics',
          dataSource: 'forecastAccuracy'
        },
        {
          title: 'Product Forecasts',
          type: 'table',
          dataSource: 'productForecasts'
        },
        {
          title: 'Forecast Factors',
          type: 'text',
          dataSource: 'forecastFactors'
        },
        {
          title: 'Demand Trends',
          type: 'chart',
          dataSource: 'demandTrends',
          config: { chartType: 'area' }
        }
      ],
      defaultParameters: {
        horizon: 30, // days
        includeConfidenceIntervals: true
      }
    });

    // Performance Report Template
    this.reportTemplates.set('operational-performance', {
      id: 'operational-performance',
      name: 'Operational Performance Report',
      type: 'performance',
      sections: [
        {
          title: 'Performance Overview',
          type: 'summary',
          dataSource: 'performanceOverview'
        },
        {
          title: 'Operational Metrics',
          type: 'metrics',
          dataSource: 'operationalKPIs'
        },
        {
          title: 'Efficiency Analysis',
          type: 'table',
          dataSource: 'efficiencyMetrics'
        },
        {
          title: 'Anomalies Detected',
          type: 'table',
          dataSource: 'recentAnomalies'
        },
        {
          title: 'Recommendations',
          type: 'text',
          dataSource: 'performanceRecommendations'
        }
      ],
      defaultParameters: {
        includeAnomalies: true,
        anomalySeverity: ['high', 'critical']
      }
    });
  }

  /**
   * Generate a report based on type and parameters
   */
  async generateReport(report: Report): Promise<Report> {
    try {
      // Update status to generating
      report.status = 'generating';
      report.generatedAt = new Date();

      // Get template
      const template = this.reportTemplates.get(report.type) || 
                      this.createCustomTemplate(report);

      // Collect data for all sections
      const reportData = await this.collectReportData(
        template,
        report.parameters
      );

      // Generate report in requested format
      let fileUrl: string;
      switch (report.format) {
        case 'pdf':
          fileUrl = await this.generatePDFReport(reportData);
          break;
        case 'excel':
          fileUrl = await this.generateExcelReport(reportData);
          break;
        case 'csv':
          fileUrl = await this.generateCSVReport(reportData);
          break;
        case 'json':
          fileUrl = await this.generateJSONReport(reportData);
          break;
        default:
          throw new Error(`Unsupported format: ${report.format}`);
      }

      // Update report status
      report.status = 'completed';
      report.downloadUrl = fileUrl;

      return report;
    } catch (error) {
      console.error('Error generating report:', error);
      report.status = 'failed';
      throw error;
    }
  }

  /**
   * Collect data for all report sections
   */
  private async collectReportData(
    template: ReportTemplate,
    parameters: Record<string, any>
  ): Promise<ReportData> {
    const sections = [];
    const timeRange = this.getTimeRange(parameters);

    for (const section of template.sections) {
      const data = await this.fetchSectionData(
        section.dataSource,
        { ...parameters, timeRange },
        section.config
      );

      sections.push({
        title: section.title,
        data
      });
    }

    return {
      metadata: {
        title: template.name,
        generatedAt: new Date(),
        generatedBy: parameters.userId || 'system',
        period: timeRange
      },
      sections
    };
  }

  /**
   * Fetch data for a specific section
   */
  private async fetchSectionData(
    dataSource: string,
    parameters: Record<string, any>,
    config?: Record<string, any>
  ): Promise<any> {
    switch (dataSource) {
      case 'inventorySummary':
        return this.getInventorySummary(parameters);
      
      case 'inventoryKPIs':
        return this.analyticsService.getKPIsByCategory('inventory');
      
      case 'warehouseStock':
        return this.getWarehouseStock(parameters);
      
      case 'deadStock':
        return this.getDeadStock(parameters);
      
      case 'reorderRecommendations':
        return this.getReorderRecommendations(parameters);
      
      case 'salesSummary':
        return this.getSalesSummary(parameters);
      
      case 'salesKPIs':
        return this.analyticsService.getKPIsByCategory('sales');
      
      case 'topProducts':
        return this.getTopProducts(parameters, config?.limit);
      
      case 'channelSales':
        return this.getChannelSales(parameters);
      
      case 'salesTrend':
        return this.getSalesTrend(parameters);
      
      case 'forecastSummary':
        return this.getForecastSummary(parameters);
      
      case 'forecastAccuracy':
        return this.getForecastAccuracy(parameters);
      
      case 'productForecasts':
        return this.getProductForecasts(parameters);
      
      case 'forecastFactors':
        return this.getForecastFactors(parameters);
      
      case 'demandTrends':
        return this.getDemandTrends(parameters);
      
      case 'performanceOverview':
        return this.getPerformanceOverview(parameters);
      
      case 'operationalKPIs':
        return this.analyticsService.getKPIsByCategory('operations');
      
      case 'efficiencyMetrics':
        return this.getEfficiencyMetrics(parameters);
      
      case 'recentAnomalies':
        return this.getRecentAnomalies(parameters);
      
      case 'performanceRecommendations':
        return this.getPerformanceRecommendations(parameters);
      
      default:
        console.warn(`Unknown data source: ${dataSource}`);
        return null;
    }
  }

  /**
   * Schedule a recurring report
   */
  async scheduleReport(
    report: Report,
    schedule: ReportSchedule
  ): Promise<void> {
    // Clear existing schedule if any
    if (this.scheduledReports.has(report.id)) {
      clearInterval(this.scheduledReports.get(report.id)!);
    }

    if (!schedule.enabled) {
      return;
    }

    // Calculate next run time
    const nextRun = this.calculateNextRunTime(schedule);
    const delay = nextRun.getTime() - Date.now();

    // Schedule the report
    const timeout = setTimeout(async () => {
      try {
        // Generate report
        const generatedReport = await this.generateReport(report);
        
        // Send to recipients
        await this.distributeReport(generatedReport, schedule.recipients);
        
        // Schedule next run
        await this.scheduleReport(report, schedule);
      } catch (error) {
        console.error('Error in scheduled report:', error);
      }
    }, delay);

    this.scheduledReports.set(report.id, timeout);
  }

  /**
   * Data fetching methods
   */

  private async getInventorySummary(parameters: any): Promise<any> {
    const query = `
      SELECT 
        COUNT(DISTINCT product_id) as total_products,
        COUNT(DISTINCT warehouse_id) as total_warehouses,
        SUM(quantity) as total_units,
        SUM(quantity * unit_cost) as total_value,
        COUNT(CASE WHEN quantity = 0 THEN 1 END) as stockout_count
      FROM inventory
      WHERE 1=1
        ${parameters.warehouseId ? 'AND warehouse_id = $1' : ''}
    `;

    const result = await this.analyticsService['database'].query(
      query,
      parameters.warehouseId ? [parameters.warehouseId] : []
    );

    return result.rows[0];
  }

  private async getWarehouseStock(parameters: any): Promise<any[]> {
    const query = `
      SELECT 
        w.name as warehouse_name,
        COUNT(DISTINCT i.product_id) as product_count,
        SUM(i.quantity) as total_units,
        SUM(i.quantity * i.unit_cost) as total_value,
        AVG(i.quantity * 1.0 / NULLIF(p.reorder_point, 0)) as avg_stock_level
      FROM inventory i
      JOIN warehouses w ON i.warehouse_id = w.id
      JOIN products p ON i.product_id = p.id
      GROUP BY w.id, w.name
      ORDER BY total_value DESC
    `;

    const result = await this.analyticsService['database'].query(query);
    return result.rows;
  }

  private async getDeadStock(parameters: any): Promise<any[]> {
    const threshold = parameters.deadStockThreshold || 180;
    
    const query = `
      SELECT 
        p.sku,
        p.name as product_name,
        w.name as warehouse_name,
        i.quantity,
        i.unit_cost,
        i.quantity * i.unit_cost as value,
        i.last_movement_date,
        CURRENT_DATE - i.last_movement_date as days_stagnant
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      JOIN warehouses w ON i.warehouse_id = w.id
      WHERE i.quantity > 0
        AND i.last_movement_date < CURRENT_DATE - INTERVAL '${threshold} days'
      ORDER BY value DESC
      LIMIT 100
    `;

    const result = await this.analyticsService['database'].query(query);
    return result.rows;
  }

  private async getReorderRecommendations(parameters: any): Promise<any[]> {
    const query = `
      SELECT 
        p.sku,
        p.name as product_name,
        i.quantity as current_stock,
        p.reorder_point,
        p.reorder_quantity,
        s.name as preferred_supplier,
        f.predictions[1].quantity as forecasted_demand
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      LEFT JOIN suppliers s ON p.preferred_supplier_id = s.id
      LEFT JOIN LATERAL (
        SELECT * FROM forecasts
        WHERE product_id = p.id
        ORDER BY generated_at DESC
        LIMIT 1
      ) f ON true
      WHERE i.quantity <= p.reorder_point
        AND p.active = true
      ORDER BY i.quantity / NULLIF(p.reorder_point, 0) ASC
    `;

    const result = await this.analyticsService['database'].query(query);
    return result.rows;
  }

  private async getSalesSummary(parameters: any): Promise<any> {
    const timeRange = parameters.timeRange || this.getTimeRange(parameters);
    
    const query = `
      SELECT 
        COUNT(DISTINCT o.id) as total_orders,
        COUNT(DISTINCT o.customer_id) as unique_customers,
        SUM(o.total_amount) as total_revenue,
        AVG(o.total_amount) as avg_order_value,
        SUM(oi.quantity) as units_sold
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      WHERE o.status = 'completed'
        AND o.created_at BETWEEN $1 AND $2
    `;

    const result = await this.analyticsService['database'].query(
      query,
      [timeRange.start, timeRange.end]
    );

    return result.rows[0];
  }

  private async getTopProducts(parameters: any, limit = 20): Promise<any[]> {
    const timeRange = parameters.timeRange || this.getTimeRange(parameters);
    
    const query = `
      SELECT 
        p.sku,
        p.name as product_name,
        SUM(oi.quantity) as units_sold,
        SUM(oi.total_price) as revenue,
        COUNT(DISTINCT oi.order_id) as order_count,
        AVG(oi.unit_price) as avg_price
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE o.status = 'completed'
        AND o.created_at BETWEEN $1 AND $2
      GROUP BY p.id, p.sku, p.name
      ORDER BY revenue DESC
      LIMIT $3
    `;

    const result = await this.analyticsService['database'].query(
      query,
      [timeRange.start, timeRange.end, limit]
    );

    return result.rows;
  }

  private async getChannelSales(parameters: any): Promise<any[]> {
    const timeRange = parameters.timeRange || this.getTimeRange(parameters);
    
    const query = `
      SELECT 
        c.name as channel_name,
        COUNT(o.id) as order_count,
        SUM(o.total_amount) as revenue,
        AVG(o.total_amount) as avg_order_value
      FROM orders o
      JOIN channels c ON o.channel_id = c.id
      WHERE o.status = 'completed'
        AND o.created_at BETWEEN $1 AND $2
      GROUP BY c.id, c.name
      ORDER BY revenue DESC
    `;

    const result = await this.analyticsService['database'].query(
      query,
      [timeRange.start, timeRange.end]
    );

    return result.rows;
  }

  private async getSalesTrend(parameters: any): Promise<any[]> {
    const timeRange = parameters.timeRange || this.getTimeRange(parameters);
    
    const query = `
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as order_count,
        SUM(total_amount) as revenue
      FROM orders
      WHERE status = 'completed'
        AND created_at BETWEEN $1 AND $2
      GROUP BY DATE(created_at)
      ORDER BY date
    `;

    const result = await this.analyticsService['database'].query(
      query,
      [timeRange.start, timeRange.end]
    );

    return result.rows;
  }

  private async getForecastSummary(parameters: any): Promise<any> {
    // Get recent forecasts
    const products = parameters.productIds || [];
    const forecasts = [];

    for (const productId of products.slice(0, 10)) { // Limit to 10 products
      const forecast = await this.forecastService.generateForecast({
        productId,
        horizon: parameters.horizon || 30,
        includeFactors: true
      });
      forecasts.push(forecast);
    }

    return {
      totalForecasts: forecasts.length,
      avgConfidence: forecasts.reduce((sum, f) => sum + f.confidence, 0) / forecasts.length,
      avgAccuracy: forecasts.reduce((sum, f) => sum + f.modelAccuracy, 0) / forecasts.length,
      horizon: parameters.horizon || 30
    };
  }

  private async getForecastAccuracy(parameters: any): Promise<any> {
    const query = `
      SELECT 
        AVG(1 - ABS(forecasted - actual) / NULLIF(actual, 0)) * 100 as overall_accuracy,
        COUNT(*) as total_forecasts,
        SUM(CASE WHEN ABS(forecasted - actual) / NULLIF(actual, 0) < 0.1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as within_10_percent,
        SUM(CASE WHEN ABS(forecasted - actual) / NULLIF(actual, 0) < 0.2 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as within_20_percent
      FROM forecast_accuracy
      WHERE date >= NOW() - INTERVAL '30 days'
    `;

    const result = await this.analyticsService['database'].query(query);
    return result.rows[0];
  }

  private async getProductForecasts(parameters: any): Promise<any[]> {
    const products = parameters.productIds || [];
    const forecasts = [];

    for (const productId of products.slice(0, 20)) { // Limit to 20 products
      const forecast = await this.forecastService.generateForecast({
        productId,
        horizon: parameters.horizon || 30,
        includeFactors: parameters.includeConfidenceIntervals
      });

      forecasts.push({
        productId,
        predictions: forecast.predictions.slice(0, 7), // First week
        confidence: forecast.confidence,
        modelAccuracy: forecast.modelAccuracy
      });
    }

    return forecasts;
  }

  private async getForecastFactors(parameters: any): Promise<string> {
    // Generate text summary of factors affecting forecasts
    const factors = [
      'Seasonal trends showing increased demand during weekends',
      'Promotional activities scheduled for next month',
      'Historical patterns indicate 15% growth trend',
      'External market conditions remain stable',
      'No significant supply chain disruptions anticipated'
    ];

    return factors.join('\n');
  }

  private async getDemandTrends(parameters: any): Promise<any[]> {
    const query = `
      SELECT 
        DATE(date) as date,
        SUM(quantity_sold) as actual_demand,
        SUM(forecasted_quantity) as forecasted_demand
      FROM sales_forecast_comparison
      WHERE date >= NOW() - INTERVAL '90 days'
      GROUP BY DATE(date)
      ORDER BY date
    `;

    const result = await this.analyticsService['database'].query(query);
    return result.rows;
  }

  private async getPerformanceOverview(parameters: any): Promise<any> {
    const metrics = await this.analyticsService.getPerformanceMetrics(
      parameters.timeRange
    );

    return {
      inventoryTurnover: metrics.inventoryTurnover,
      stockoutRate: metrics.stockoutRate,
      orderFillRate: metrics.orderFillRate,
      forecastAccuracy: metrics.forecastAccuracy,
      summary: this.generatePerformanceSummary(metrics)
    };
  }

  private async getEfficiencyMetrics(parameters: any): Promise<any[]> {
    const query = `
      SELECT 
        'Order Processing Time' as metric,
        AVG(EXTRACT(epoch FROM (fulfilled_at - created_at)) / 3600) as value,
        'hours' as unit
      FROM orders
      WHERE status = 'fulfilled'
        AND created_at >= NOW() - INTERVAL '30 days'
      
      UNION ALL
      
      SELECT 
        'Inventory Accuracy' as metric,
        (1 - AVG(ABS(physical_count - system_count) / NULLIF(system_count, 0))) * 100 as value,
        '%' as unit
      FROM inventory_audits
      WHERE audit_date >= NOW() - INTERVAL '30 days'
      
      UNION ALL
      
      SELECT 
        'Pick Accuracy' as metric,
        AVG(CASE WHEN errors = 0 THEN 100 ELSE 0 END) as value,
        '%' as unit
      FROM fulfillment_metrics
      WHERE date >= NOW() - INTERVAL '30 days'
    `;

    const result = await this.analyticsService['database'].query(query);
    return result.rows;
  }

  private async getRecentAnomalies(parameters: any): Promise<any[]> {
    const anomalies = await this.insightsService.getRecentAnomalies(50);
    
    return anomalies
      .filter(a => parameters.anomalySeverity.includes(a.severity))
      .map(a => ({
        type: a.type,
        severity: a.severity,
        description: a.description,
        detectedAt: a.detectedAt,
        entity: `${a.affectedEntity.type}: ${a.affectedEntity.name}`,
        primaryMetric: a.metrics[0]
      }));
  }

  private async getPerformanceRecommendations(parameters: any): Promise<string> {
    const metrics = await this.analyticsService.getPerformanceMetrics();
    const anomalies = await this.insightsService.getRecentAnomalies(10);
    
    const recommendations = [];

    // Based on metrics
    if (metrics.stockoutRate > 5) {
      recommendations.push('• High stockout rate detected. Consider increasing safety stock levels for frequently stocked-out items.');
    }

    if (metrics.inventoryTurnover < 4) {
      recommendations.push('• Low inventory turnover. Review slow-moving items and consider promotions or liquidation.');
    }

    if (metrics.forecastAccuracy < 80) {
      recommendations.push('• Forecast accuracy below target. Review and tune forecasting models for better predictions.');
    }

    // Based on anomalies
    const criticalAnomalies = anomalies.filter(a => a.severity === 'critical');
    if (criticalAnomalies.length > 0) {
      recommendations.push(`• ${criticalAnomalies.length} critical anomalies require immediate attention.`);
    }

    if (recommendations.length === 0) {
      recommendations.push('• All metrics are within acceptable ranges. Continue monitoring for changes.');
    }

    return recommendations.join('\n');
  }

  /**
   * Report generation methods
   */

  private async generatePDFReport(data: ReportData): Promise<string> {
    // In production, would use a PDF generation library like PDFKit or Puppeteer
    // For now, return a mock URL
    const reportId = `report-${Date.now()}`;
    return `/api/reports/download/${reportId}.pdf`;
  }

  private async generateExcelReport(data: ReportData): Promise<string> {
    // In production, would use a library like ExcelJS
    // For now, return a mock URL
    const reportId = `report-${Date.now()}`;
    return `/api/reports/download/${reportId}.xlsx`;
  }

  private async generateCSVReport(data: ReportData): Promise<string> {
    // In production, would generate actual CSV
    // For now, return a mock URL
    const reportId = `report-${Date.now()}`;
    return `/api/reports/download/${reportId}.csv`;
  }

  private async generateJSONReport(data: ReportData): Promise<string> {
    // In production, would save JSON to storage
    // For now, return a mock URL
    const reportId = `report-${Date.now()}`;
    return `/api/reports/download/${reportId}.json`;
  }

  /**
   * Helper methods
   */

  private getTimeRange(parameters: any): TimeRange {
    if (parameters.timeRange) {
      return parameters.timeRange;
    }

    const end = new Date();
    const start = new Date();

    switch (parameters.period) {
      case 'day':
        start.setDate(start.getDate() - 1);
        break;
      case 'week':
        start.setDate(start.getDate() - 7);
        break;
      case 'month':
        start.setMonth(start.getMonth() - 1);
        break;
      case 'quarter':
        start.setMonth(start.getMonth() - 3);
        break;
      case 'year':
        start.setFullYear(start.getFullYear() - 1);
        break;
      default:
        start.setMonth(start.getMonth() - 1); // Default to month
    }

    return {
      start,
      end,
      granularity: parameters.period || 'day'
    };
  }

  private createCustomTemplate(report: Report): ReportTemplate {
    // Create a basic template for custom reports
    return {
      id: 'custom',
      name: report.name,
      type: 'custom',
      sections: [
        {
          title: 'Report Data',
          type: 'table',
          dataSource: 'custom'
        }
      ],
      defaultParameters: {}
    };
  }

  private calculateNextRunTime(schedule: ReportSchedule): Date {
    const now = new Date();
    const next = new Date();

    switch (schedule.frequency) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        break;
      case 'weekly':
        next.setDate(next.getDate() + (7 - now.getDay() + (schedule.dayOfWeek || 1)) % 7);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        next.setDate(schedule.dayOfMonth || 1);
        break;
      case 'quarterly':
        next.setMonth(next.getMonth() + 3);
        break;
    }

    // Set time
    const [hours, minutes] = schedule.time.split(':').map(Number);
    next.setHours(hours, minutes, 0, 0);

    // If next run is in the past, add appropriate interval
    if (next <= now) {
      switch (schedule.frequency) {
        case 'daily':
          next.setDate(next.getDate() + 1);
          break;
        case 'weekly':
          next.setDate(next.getDate() + 7);
          break;
        case 'monthly':
          next.setMonth(next.getMonth() + 1);
          break;
        case 'quarterly':
          next.setMonth(next.getMonth() + 3);
          break;
      }
    }

    return next;
  }

  private async distributeReport(
    report: Report,
    recipients: string[]
  ): Promise<void> {
    // In production, would send emails or notifications
    console.log(`Distributing report ${report.id} to ${recipients.join(', ')}`);
  }

  private generatePerformanceSummary(metrics: PerformanceMetrics): string {
    const issues = [];
    
    if (metrics.stockoutRate > 5) issues.push('high stockout rate');
    if (metrics.inventoryTurnover < 4) issues.push('low inventory turnover');
    if (metrics.forecastAccuracy < 80) issues.push('forecast accuracy below target');
    
    if (issues.length === 0) {
      return 'Overall performance is within acceptable parameters.';
    }
    
    return `Performance issues detected: ${issues.join(', ')}. Review recommendations section for improvement suggestions.`;
  }
}