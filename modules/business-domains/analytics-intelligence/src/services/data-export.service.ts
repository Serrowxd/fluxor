/**
 * Data Export Service
 * Handles exporting analytics data in various formats
 */

import {
  ExportConfig,
  AnalyticsQuery,
  QueryFilter,
  TimeRange
} from '../types';
import { AnalyticsService } from './analytics.service';
import { ForecastService } from './forecast.service';
import { InsightsService } from './insights.service';

interface ExportJob {
  id: string;
  config: ExportConfig;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  fileUrl?: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

interface DataStream {
  query: AnalyticsQuery;
  batchSize: number;
  offset: number;
  hasMore: boolean;
}

export class DataExportService {
  private analyticsService: AnalyticsService;
  private forecastService: ForecastService;
  private insightsService: InsightsService;
  private exportJobs: Map<string, ExportJob> = new Map();
  private activeStreams: Map<string, DataStream> = new Map();

  constructor(
    analyticsService: AnalyticsService,
    forecastService: ForecastService,
    insightsService: InsightsService
  ) {
    this.analyticsService = analyticsService;
    this.forecastService = forecastService;
    this.insightsService = insightsService;
  }

  /**
   * Export analytics data
   */
  async exportData(
    dataType: 'kpis' | 'inventory' | 'sales' | 'forecasts' | 'anomalies' | 'custom',
    config: ExportConfig,
    query?: AnalyticsQuery
  ): Promise<ExportJob> {
    const job: ExportJob = {
      id: `export-${Date.now()}`,
      config,
      status: 'pending',
      progress: 0,
      startedAt: new Date()
    };

    this.exportJobs.set(job.id, job);

    // Process export asynchronously
    this.processExport(job, dataType, query).catch(error => {
      job.status = 'failed';
      job.error = error.message;
      console.error('Export failed:', error);
    });

    return job;
  }

  /**
   * Process export job
   */
  private async processExport(
    job: ExportJob,
    dataType: string,
    query?: AnalyticsQuery
  ): Promise<void> {
    try {
      job.status = 'processing';

      // Fetch data based on type
      const data = await this.fetchExportData(dataType, job.config, query);
      job.progress = 50;

      // Apply filters if specified
      const filteredData = this.applyFilters(data, job.config.filters);
      job.progress = 60;

      // Select columns if specified
      const selectedData = this.selectColumns(filteredData, job.config.columns);
      job.progress = 70;

      // Generate file based on format
      let fileUrl: string;
      switch (job.config.format) {
        case 'csv':
          fileUrl = await this.generateCSV(selectedData, job.config);
          break;
        case 'excel':
          fileUrl = await this.generateExcel(selectedData, job.config);
          break;
        case 'json':
          fileUrl = await this.generateJSON(selectedData, job.config);
          break;
        case 'parquet':
          fileUrl = await this.generateParquet(selectedData, job.config);
          break;
        default:
          throw new Error(`Unsupported format: ${job.config.format}`);
      }

      job.progress = 100;
      job.status = 'completed';
      job.fileUrl = fileUrl;
      job.completedAt = new Date();

    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      throw error;
    }
  }

  /**
   * Fetch data for export
   */
  private async fetchExportData(
    dataType: string,
    config: ExportConfig,
    query?: AnalyticsQuery
  ): Promise<any[]> {
    switch (dataType) {
      case 'kpis':
        return this.fetchKPIData();
      
      case 'inventory':
        return this.fetchInventoryData(config);
      
      case 'sales':
        return this.fetchSalesData(config);
      
      case 'forecasts':
        return this.fetchForecastData(config);
      
      case 'anomalies':
        return this.fetchAnomalyData(config);
      
      case 'custom':
        if (!query) {
          throw new Error('Query required for custom export');
        }
        return this.fetchCustomData(query);
      
      default:
        throw new Error(`Unknown data type: ${dataType}`);
    }
  }

  /**
   * Create a streaming export for large datasets
   */
  async createStreamingExport(
    query: AnalyticsQuery,
    config: ExportConfig,
    batchSize = 1000
  ): Promise<string> {
    const streamId = `stream-${Date.now()}`;
    
    this.activeStreams.set(streamId, {
      query,
      batchSize,
      offset: 0,
      hasMore: true
    });

    // Initialize the export file
    await this.initializeStreamingFile(streamId, config);

    return streamId;
  }

  /**
   * Stream next batch of data
   */
  async streamNextBatch(streamId: string): Promise<{
    data: any[];
    hasMore: boolean;
    progress: number;
  }> {
    const stream = this.activeStreams.get(streamId);
    if (!stream) {
      throw new Error('Stream not found');
    }

    // Fetch next batch
    const result = await this.analyticsService.executeQuery({
      ...stream.query,
      limit: stream.batchSize,
      offset: stream.offset
    });

    stream.offset += result.data.length;
    stream.hasMore = result.data.length === stream.batchSize;

    const estimatedTotal = stream.offset + (stream.hasMore ? stream.batchSize : 0);
    const progress = (stream.offset / estimatedTotal) * 100;

    if (!stream.hasMore) {
      this.activeStreams.delete(streamId);
    }

    return {
      data: result.data,
      hasMore: stream.hasMore,
      progress
    };
  }

  /**
   * Get export job status
   */
  getExportStatus(jobId: string): ExportJob | null {
    return this.exportJobs.get(jobId) || null;
  }

  /**
   * Cancel export job
   */
  cancelExport(jobId: string): boolean {
    const job = this.exportJobs.get(jobId);
    if (job && job.status === 'processing') {
      job.status = 'failed';
      job.error = 'Export cancelled by user';
      return true;
    }
    return false;
  }

  /**
   * Data fetching methods
   */

  private async fetchKPIData(): Promise<any[]> {
    const kpis = await this.analyticsService.calculateDailyKPIs();
    return kpis.map(kpi => ({
      id: kpi.id,
      name: kpi.name,
      value: kpi.value,
      unit: kpi.unit,
      trend: kpi.trend,
      percentageChange: kpi.percentageChange,
      category: kpi.category,
      lastUpdated: kpi.lastUpdated
    }));
  }

  private async fetchInventoryData(config: ExportConfig): Promise<any[]> {
    const query = `
      SELECT 
        p.sku,
        p.name as product_name,
        p.category,
        w.name as warehouse_name,
        i.quantity,
        i.unit_cost,
        i.quantity * i.unit_cost as value,
        i.last_movement_date,
        p.reorder_point,
        p.reorder_quantity
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      JOIN warehouses w ON i.warehouse_id = w.id
      WHERE 1=1
      ORDER BY p.sku, w.name
    `;

    const result = await this.analyticsService['database'].query(query);
    return result.rows;
  }

  private async fetchSalesData(config: ExportConfig): Promise<any[]> {
    const query = `
      SELECT 
        o.order_number,
        o.created_at as order_date,
        o.status,
        c.name as customer_name,
        ch.name as channel_name,
        p.sku,
        p.name as product_name,
        oi.quantity,
        oi.unit_price,
        oi.total_price,
        o.total_amount as order_total
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      JOIN customers c ON o.customer_id = c.id
      JOIN channels ch ON o.channel_id = ch.id
      WHERE o.created_at >= NOW() - INTERVAL '30 days'
      ORDER BY o.created_at DESC, o.id, oi.id
    `;

    const result = await this.analyticsService['database'].query(query);
    return result.rows;
  }

  private async fetchForecastData(config: ExportConfig): Promise<any[]> {
    const query = `
      SELECT 
        p.sku,
        p.name as product_name,
        f.date,
        f.quantity as forecasted_quantity,
        f.confidence,
        f.confidence_lower,
        f.confidence_upper,
        f.model_accuracy
      FROM forecast_predictions f
      JOIN products p ON f.product_id = p.id
      WHERE f.generated_at >= NOW() - INTERVAL '7 days'
        AND f.date >= CURRENT_DATE
        AND f.date <= CURRENT_DATE + INTERVAL '30 days'
      ORDER BY p.sku, f.date
    `;

    const result = await this.analyticsService['database'].query(query);
    return result.rows;
  }

  private async fetchAnomalyData(config: ExportConfig): Promise<any[]> {
    const anomalies = await this.insightsService.getRecentAnomalies(1000);
    
    return anomalies.map(anomaly => ({
      id: anomaly.id,
      type: anomaly.type,
      severity: anomaly.severity,
      description: anomaly.description,
      detectedAt: anomaly.detectedAt,
      entityType: anomaly.affectedEntity.type,
      entityId: anomaly.affectedEntity.id,
      entityName: anomaly.affectedEntity.name,
      primaryMetric: anomaly.metrics[0]?.name,
      expectedValue: anomaly.metrics[0]?.expectedValue,
      actualValue: anomaly.metrics[0]?.actualValue,
      deviation: anomaly.metrics[0]?.deviation,
      isResolved: anomaly.isResolved
    }));
  }

  private async fetchCustomData(query: AnalyticsQuery): Promise<any[]> {
    const result = await this.analyticsService.executeQuery(query);
    return result.data;
  }

  /**
   * Data transformation methods
   */

  private applyFilters(data: any[], filters?: QueryFilter[]): any[] {
    if (!filters || filters.length === 0) {
      return data;
    }

    return data.filter(row => {
      return filters.every(filter => {
        const value = row[filter.field];
        
        switch (filter.operator) {
          case 'eq':
            return value === filter.value;
          case 'ne':
            return value !== filter.value;
          case 'gt':
            return value > filter.value;
          case 'gte':
            return value >= filter.value;
          case 'lt':
            return value < filter.value;
          case 'lte':
            return value <= filter.value;
          case 'in':
            return Array.isArray(filter.value) && filter.value.includes(value);
          case 'nin':
            return Array.isArray(filter.value) && !filter.value.includes(value);
          case 'like':
            return String(value).toLowerCase().includes(String(filter.value).toLowerCase());
          default:
            return true;
        }
      });
    });
  }

  private selectColumns(data: any[], columns?: string[]): any[] {
    if (!columns || columns.length === 0) {
      return data;
    }

    return data.map(row => {
      const selected: any = {};
      columns.forEach(col => {
        if (col in row) {
          selected[col] = row[col];
        }
      });
      return selected;
    });
  }

  /**
   * File generation methods
   */

  private async generateCSV(data: any[], config: ExportConfig): Promise<string> {
    if (data.length === 0) {
      return this.saveFile('', 'csv', config.compression);
    }

    const headers = config.includeHeaders !== false ? Object.keys(data[0]) : [];
    const rows = data.map(row => 
      Object.values(row).map(val => this.escapeCSVValue(val))
    );

    let csv = '';
    if (headers.length > 0) {
      csv += headers.map(h => this.escapeCSVValue(h)).join(',') + '\n';
    }
    csv += rows.map(row => row.join(',')).join('\n');

    return this.saveFile(csv, 'csv', config.compression);
  }

  private async generateExcel(data: any[], config: ExportConfig): Promise<string> {
    // In production, would use ExcelJS or similar library
    // For now, generate CSV and return with .xlsx extension
    const csv = await this.generateCSV(data, config);
    return csv.replace('.csv', '.xlsx');
  }

  private async generateJSON(data: any[], config: ExportConfig): Promise<string> {
    const json = JSON.stringify(data, null, 2);
    return this.saveFile(json, 'json', config.compression);
  }

  private async generateParquet(data: any[], config: ExportConfig): Promise<string> {
    // In production, would use parquet-js or similar library
    // For now, generate JSON and return with .parquet extension
    const json = await this.generateJSON(data, config);
    return json.replace('.json', '.parquet');
  }

  /**
   * Helper methods
   */

  private escapeCSVValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    const stringValue = String(value);
    
    // Escape if contains comma, quote, or newline
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    return stringValue;
  }

  private async saveFile(
    content: string,
    format: string,
    compression?: 'gzip' | 'zip'
  ): Promise<string> {
    // In production, would save to S3, cloud storage, etc.
    // For now, return a mock URL
    const timestamp = Date.now();
    const extension = compression ? `${format}.${compression}` : format;
    return `/api/exports/download/export-${timestamp}.${extension}`;
  }

  private async initializeStreamingFile(
    streamId: string,
    config: ExportConfig
  ): Promise<void> {
    // In production, would initialize the file for streaming writes
    console.log(`Initialized streaming file for ${streamId}`);
  }

  /**
   * Schedule data exports
   */
  async scheduleExport(
    schedule: {
      frequency: 'daily' | 'weekly' | 'monthly';
      time: string;
      dataType: string;
      config: ExportConfig;
      recipients: string[];
    }
  ): Promise<string> {
    // In production, would create a scheduled job
    const scheduleId = `schedule-${Date.now()}`;
    console.log(`Created export schedule ${scheduleId}`);
    return scheduleId;
  }

  /**
   * Export templates for common use cases
   */
  getExportTemplates(): Array<{
    id: string;
    name: string;
    description: string;
    dataType: string;
    config: ExportConfig;
  }> {
    return [
      {
        id: 'inventory-snapshot',
        name: 'Inventory Snapshot',
        description: 'Current inventory levels across all warehouses',
        dataType: 'inventory',
        config: {
          format: 'excel',
          includeHeaders: true,
          columns: [
            'sku',
            'product_name',
            'warehouse_name',
            'quantity',
            'value',
            'reorder_point'
          ]
        }
      },
      {
        id: 'sales-report',
        name: 'Sales Report',
        description: 'Sales transactions for the last 30 days',
        dataType: 'sales',
        config: {
          format: 'csv',
          includeHeaders: true,
          compression: 'gzip'
        }
      },
      {
        id: 'forecast-export',
        name: 'Demand Forecast',
        description: 'Product demand forecasts for the next 30 days',
        dataType: 'forecasts',
        config: {
          format: 'excel',
          includeHeaders: true
        }
      },
      {
        id: 'anomaly-report',
        name: 'Anomaly Report',
        description: 'Recent anomalies detected in the system',
        dataType: 'anomalies',
        config: {
          format: 'json',
          filters: [
            { field: 'severity', operator: 'in', value: ['high', 'critical'] }
          ]
        }
      }
    ];
  }
}