/**
 * Analytics Controller
 * Handles API endpoints for analytics operations
 */

import { AnalyticsService } from '../services/analytics.service';
import { ForecastService } from '../services/forecast.service';
import { InsightsService } from '../services/insights.service';
import { ReportGenerationService } from '../services/report-generation.service';
import { DataExportService } from '../services/data-export.service';
import {
  KPI,
  Dashboard,
  AnalyticsQuery,
  Report,
  ExportConfig,
  Anomaly,
  Forecast
} from '../types';

export class AnalyticsController {
  private analyticsService: AnalyticsService;
  private forecastService: ForecastService;
  private insightsService: InsightsService;
  private reportGenerationService: ReportGenerationService;
  private dataExportService: DataExportService;

  constructor(
    analyticsService: AnalyticsService,
    forecastService: ForecastService,
    insightsService: InsightsService,
    reportGenerationService: ReportGenerationService,
    dataExportService: DataExportService
  ) {
    this.analyticsService = analyticsService;
    this.forecastService = forecastService;
    this.insightsService = insightsService;
    this.reportGenerationService = reportGenerationService;
    this.dataExportService = dataExportService;
  }

  /**
   * KPI Endpoints
   */

  async getKPIs(req: any, res: any): Promise<void> {
    try {
      const { category } = req.query;
      
      let kpis: KPI[];
      if (category) {
        kpis = await this.analyticsService.getKPIsByCategory(category);
      } else {
        kpis = await this.analyticsService.calculateDailyKPIs();
      }

      res.status(200).json({
        success: true,
        data: kpis
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async getKPIById(req: any, res: any): Promise<void> {
    try {
      const { kpiId } = req.params;
      const kpi = await this.analyticsService.getKPI(kpiId);

      if (!kpi) {
        res.status(404).json({
          success: false,
          error: 'KPI not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: kpi
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async refreshKPIs(req: any, res: any): Promise<void> {
    try {
      const kpis = await this.analyticsService.calculateDailyKPIs();
      
      res.status(200).json({
        success: true,
        data: kpis,
        message: 'KPIs refreshed successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Dashboard Endpoints
   */

  async getDashboards(req: any, res: any): Promise<void> {
    try {
      const { userId } = req.user;
      
      // In production, would fetch from database
      const dashboards = []; // Placeholder
      
      res.status(200).json({
        success: true,
        data: dashboards
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async getDashboard(req: any, res: any): Promise<void> {
    try {
      const { dashboardId } = req.params;
      const dashboard = await this.analyticsService.getDashboard(dashboardId);

      if (!dashboard) {
        res.status(404).json({
          success: false,
          error: 'Dashboard not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: dashboard
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async createDashboard(req: any, res: any): Promise<void> {
    try {
      const { userId } = req.user;
      const dashboardData = {
        ...req.body,
        createdBy: userId,
        lastModified: new Date()
      };

      const dashboard = await this.analyticsService.saveDashboard(dashboardData);
      
      res.status(201).json({
        success: true,
        data: dashboard
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async updateDashboard(req: any, res: any): Promise<void> {
    try {
      const { dashboardId } = req.params;
      const updates = req.body;

      const dashboard = await this.analyticsService.saveDashboard({
        id: dashboardId,
        ...updates,
        lastModified: new Date()
      });

      res.status(200).json({
        success: true,
        data: dashboard
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Analytics Query Endpoints
   */

  async executeQuery(req: any, res: any): Promise<void> {
    try {
      const query: AnalyticsQuery = req.body;
      
      // Validate query
      if (!query.metrics || query.metrics.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Metrics are required'
        });
        return;
      }

      const result = await this.analyticsService.executeQuery(query);
      
      res.status(200).json({
        success: true,
        data: result.data,
        metadata: result.metadata
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async getPerformanceMetrics(req: any, res: any): Promise<void> {
    try {
      const { startDate, endDate } = req.query;
      
      const timeRange = startDate && endDate ? {
        start: new Date(startDate),
        end: new Date(endDate),
        granularity: 'day' as const
      } : undefined;

      const metrics = await this.analyticsService.getPerformanceMetrics(timeRange);
      
      res.status(200).json({
        success: true,
        data: metrics
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Forecast Endpoints
   */

  async generateForecast(req: any, res: any): Promise<void> {
    try {
      const {
        productId,
        warehouseId,
        horizon = 30,
        includeFactors = true,
        externalFactors
      } = req.body;

      if (!productId) {
        res.status(400).json({
          success: false,
          error: 'Product ID is required'
        });
        return;
      }

      const forecast = await this.forecastService.generateForecast({
        productId,
        warehouseId,
        horizon,
        includeFactors,
        externalFactors
      });

      res.status(200).json({
        success: true,
        data: forecast
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async updateForecastAccuracy(req: any, res: any): Promise<void> {
    try {
      const { productId, date, forecasted, actual } = req.body;

      await this.forecastService.updateForecastAccuracy(
        productId,
        new Date(date),
        forecasted,
        actual
      );

      res.status(200).json({
        success: true,
        message: 'Forecast accuracy updated'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Insights Endpoints
   */

  async getAnomalies(req: any, res: any): Promise<void> {
    try {
      const { 
        entityType,
        entityId,
        severity,
        type,
        limit = 100
      } = req.query;

      let anomalies: Anomaly[];
      
      if (entityType && entityId) {
        anomalies = await this.insightsService.getAnomaliesByEntity(entityType, entityId);
      } else {
        anomalies = await this.insightsService.getRecentAnomalies(limit);
      }

      // Filter by severity if specified
      if (severity) {
        const severities = Array.isArray(severity) ? severity : [severity];
        anomalies = anomalies.filter(a => severities.includes(a.severity));
      }

      // Filter by type if specified
      if (type) {
        anomalies = anomalies.filter(a => a.type === type);
      }

      res.status(200).json({
        success: true,
        data: anomalies
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async runAnomalyDetection(req: any, res: any): Promise<void> {
    try {
      const anomalies = await this.insightsService.runAnomalyDetection();
      
      res.status(200).json({
        success: true,
        data: anomalies,
        message: `Detected ${anomalies.length} anomalies`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async resolveAnomaly(req: any, res: any): Promise<void> {
    try {
      const { anomalyId } = req.params;
      const { resolution } = req.body;

      if (!resolution) {
        res.status(400).json({
          success: false,
          error: 'Resolution is required'
        });
        return;
      }

      await this.insightsService.resolveAnomaly(anomalyId, resolution);
      
      res.status(200).json({
        success: true,
        message: 'Anomaly resolved'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async updateDetectionConfig(req: any, res: any): Promise<void> {
    try {
      const config = req.body;
      
      this.insightsService.updateDetectionConfig(config);
      
      res.status(200).json({
        success: true,
        message: 'Detection configuration updated'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Report Endpoints
   */

  async generateReport(req: any, res: any): Promise<void> {
    try {
      const { userId } = req.user;
      const reportRequest: Report = {
        ...req.body,
        id: `report-${Date.now()}`,
        generatedBy: userId,
        status: 'pending'
      };

      const report = await this.reportGenerationService.generateReport(reportRequest);
      
      res.status(200).json({
        success: true,
        data: report
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async scheduleReport(req: any, res: any): Promise<void> {
    try {
      const { report, schedule } = req.body;

      await this.reportGenerationService.scheduleReport(report, schedule);
      
      res.status(200).json({
        success: true,
        message: 'Report scheduled successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Export Endpoints
   */

  async exportData(req: any, res: any): Promise<void> {
    try {
      const { dataType, config, query } = req.body;

      if (!dataType || !config) {
        res.status(400).json({
          success: false,
          error: 'Data type and config are required'
        });
        return;
      }

      const job = await this.dataExportService.exportData(dataType, config, query);
      
      res.status(200).json({
        success: true,
        data: job
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async getExportStatus(req: any, res: any): Promise<void> {
    try {
      const { jobId } = req.params;
      const job = this.dataExportService.getExportStatus(jobId);

      if (!job) {
        res.status(404).json({
          success: false,
          error: 'Export job not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: job
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async cancelExport(req: any, res: any): Promise<void> {
    try {
      const { jobId } = req.params;
      const cancelled = this.dataExportService.cancelExport(jobId);

      if (!cancelled) {
        res.status(400).json({
          success: false,
          error: 'Cannot cancel export'
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Export cancelled'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async createStreamingExport(req: any, res: any): Promise<void> {
    try {
      const { query, config, batchSize = 1000 } = req.body;

      if (!query || !config) {
        res.status(400).json({
          success: false,
          error: 'Query and config are required'
        });
        return;
      }

      const streamId = await this.dataExportService.createStreamingExport(
        query,
        config,
        batchSize
      );

      res.status(200).json({
        success: true,
        data: { streamId }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async streamNextBatch(req: any, res: any): Promise<void> {
    try {
      const { streamId } = req.params;
      const result = await this.dataExportService.streamNextBatch(streamId);

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async getExportTemplates(req: any, res: any): Promise<void> {
    try {
      const templates = this.dataExportService.getExportTemplates();
      
      res.status(200).json({
        success: true,
        data: templates
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Register routes
   */
  getRoutes(): Array<{
    method: string;
    path: string;
    handler: (req: any, res: any) => Promise<void>;
    middleware?: string[];
  }> {
    return [
      // KPI routes
      { method: 'GET', path: '/kpis', handler: this.getKPIs.bind(this) },
      { method: 'GET', path: '/kpis/:kpiId', handler: this.getKPIById.bind(this) },
      { method: 'POST', path: '/kpis/refresh', handler: this.refreshKPIs.bind(this) },

      // Dashboard routes
      { method: 'GET', path: '/dashboards', handler: this.getDashboards.bind(this) },
      { method: 'GET', path: '/dashboards/:dashboardId', handler: this.getDashboard.bind(this) },
      { method: 'POST', path: '/dashboards', handler: this.createDashboard.bind(this) },
      { method: 'PUT', path: '/dashboards/:dashboardId', handler: this.updateDashboard.bind(this) },

      // Analytics query routes
      { method: 'POST', path: '/query', handler: this.executeQuery.bind(this) },
      { method: 'GET', path: '/performance', handler: this.getPerformanceMetrics.bind(this) },

      // Forecast routes
      { method: 'POST', path: '/forecasts', handler: this.generateForecast.bind(this) },
      { method: 'POST', path: '/forecasts/accuracy', handler: this.updateForecastAccuracy.bind(this) },

      // Insights routes
      { method: 'GET', path: '/anomalies', handler: this.getAnomalies.bind(this) },
      { method: 'POST', path: '/anomalies/detect', handler: this.runAnomalyDetection.bind(this) },
      { method: 'PUT', path: '/anomalies/:anomalyId/resolve', handler: this.resolveAnomaly.bind(this) },
      { method: 'PUT', path: '/anomalies/config', handler: this.updateDetectionConfig.bind(this) },

      // Report routes
      { method: 'POST', path: '/reports', handler: this.generateReport.bind(this) },
      { method: 'POST', path: '/reports/schedule', handler: this.scheduleReport.bind(this) },

      // Export routes
      { method: 'POST', path: '/exports', handler: this.exportData.bind(this) },
      { method: 'GET', path: '/exports/:jobId', handler: this.getExportStatus.bind(this) },
      { method: 'DELETE', path: '/exports/:jobId', handler: this.cancelExport.bind(this) },
      { method: 'POST', path: '/exports/stream', handler: this.createStreamingExport.bind(this) },
      { method: 'GET', path: '/exports/stream/:streamId/next', handler: this.streamNextBatch.bind(this) },
      { method: 'GET', path: '/exports/templates', handler: this.getExportTemplates.bind(this) }
    ];
  }
}