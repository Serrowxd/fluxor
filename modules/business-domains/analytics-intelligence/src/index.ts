/**
 * Analytics Intelligence Module
 * Provides business intelligence, forecasting, and insights
 */

import { Module, ModuleConfig, ModuleExports, HealthCheckResult } from '../../../shared/interfaces/module.interface';
import { AnalyticsService } from './services/analytics.service';
import { ForecastService } from './services/forecast.service';
import { InsightsService } from './services/insights.service';
import { ReportGenerationService } from './services/report-generation.service';
import { DataExportService } from './services/data-export.service';
import { AnalyticsController } from './controllers/analytics.controller';

export class AnalyticsIntelligenceModule implements Module {
  name = 'analytics-intelligence';
  version = '1.0.0';
  config: ModuleConfig;
  
  private analyticsService: AnalyticsService;
  private forecastService: ForecastService;
  private insightsService: InsightsService;
  private reportGenerationService: ReportGenerationService;
  private dataExportService: DataExportService;
  private analyticsController: AnalyticsController;
  private isInitialized = false;

  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;
    
    // Get dependencies
    const database = config.dependencies?.['database']?.services.database;
    if (!database) {
      throw new Error('Database dependency not found');
    }

    const cache = config.dependencies?.['cache']?.services.cache;
    if (!cache) {
      throw new Error('Cache dependency not found');
    }

    const eventBus = config.dependencies?.['event-bus']?.services.eventBus;
    if (!eventBus) {
      throw new Error('Event bus dependency not found');
    }

    // Initialize services
    this.analyticsService = new AnalyticsService(database, cache, eventBus);
    this.forecastService = new ForecastService(database, cache, eventBus);
    this.insightsService = new InsightsService(database, this.analyticsService, eventBus);
    this.reportGenerationService = new ReportGenerationService(
      this.analyticsService,
      this.forecastService,
      this.insightsService
    );
    this.dataExportService = new DataExportService(
      this.analyticsService,
      this.forecastService,
      this.insightsService
    );
    
    // Initialize controller
    this.analyticsController = new AnalyticsController(
      this.analyticsService,
      this.forecastService,
      this.insightsService,
      this.reportGenerationService,
      this.dataExportService
    );
    
    // Subscribe to relevant events
    await this.subscribeToEvents(eventBus);
    
    // Initialize scheduled tasks
    await this.initializeScheduledTasks();
    
    this.isInitialized = true;
    console.log(`${this.name} module initialized`);
  }

  private async subscribeToEvents(eventBus: any): Promise<void> {
    // Subscribe to inventory events for real-time analytics
    eventBus.subscribe('InventoryUpdated', async (event) => {
      await this.analyticsService.updateRealTimeMetrics(event);
    });

    // Subscribe to order events
    eventBus.subscribe('OrderCompleted', async (event) => {
      await this.analyticsService.updateOrderMetrics(event);
      await this.insightsService.detectOrderAnomalies(event);
    });

    // Subscribe to forecast requests
    eventBus.subscribe('ForecastRequested', async (event) => {
      await this.forecastService.generateForecast(event);
    });
  }

  private async initializeScheduledTasks(): Promise<void> {
    // Schedule daily KPI calculation
    setInterval(async () => {
      await this.analyticsService.calculateDailyKPIs();
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Schedule hourly anomaly detection
    setInterval(async () => {
      await this.insightsService.runAnomalyDetection();
    }, 60 * 60 * 1000); // 1 hour
  }

  getExports(): ModuleExports {
    if (!this.isInitialized) {
      throw new Error('Module not initialized');
    }
    
    return {
      services: {
        analyticsService: this.analyticsService,
        forecastService: this.forecastService,
        insightsService: this.insightsService,
        reportGenerationService: this.reportGenerationService,
        dataExportService: this.dataExportService
      },
      controllers: {
        analyticsController: this.analyticsController
      }
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const checks = {
      initialized: this.isInitialized,
      analyticsServiceReady: this.analyticsService?.isReady() || false,
      forecastServiceReady: this.forecastService?.isReady() || false,
      insightsServiceReady: this.insightsService?.isReady() || false
    };
    
    const isHealthy = Object.values(checks).every(check => check === true);
    
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date(),
      details: checks
    };
  }

  async shutdown(): Promise<void> {
    // Cleanup resources and stop scheduled tasks
    this.isInitialized = false;
    console.log(`${this.name} module shut down`);
  }

  isReady(): boolean {
    return this.isInitialized;
  }
}