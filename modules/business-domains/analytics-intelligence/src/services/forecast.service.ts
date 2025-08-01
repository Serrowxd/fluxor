/**
 * Forecast Service
 * Handles demand prediction and forecasting
 */

import {
  Forecast,
  ForecastPrediction,
  ForecastFactor,
  TimeRange
} from '../types';

interface ForecastRequest {
  productId: string;
  warehouseId?: string;
  horizon: number; // days to forecast
  includeFactors?: boolean;
  externalFactors?: Record<string, any>;
}

interface HistoricalData {
  date: Date;
  quantity: number;
  price?: number;
  promotions?: string[];
  seasonality?: number;
}

export class ForecastService {
  private database: any;
  private cache: any;
  private eventBus: any;
  private forecastCache: Map<string, Forecast> = new Map();
  private modelAccuracy: Map<string, number> = new Map();

  constructor(database: any, cache: any, eventBus: any) {
    this.database = database;
    this.cache = cache;
    this.eventBus = eventBus;
  }

  /**
   * Generate forecast for a product
   */
  async generateForecast(request: ForecastRequest): Promise<Forecast> {
    const cacheKey = `forecast:${request.productId}:${request.warehouseId || 'all'}:${request.horizon}`;
    
    // Check cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Get historical data
      const historicalData = await this.getHistoricalData(
        request.productId,
        request.warehouseId
      );

      if (historicalData.length < 30) {
        throw new Error('Insufficient historical data for forecasting');
      }

      // Detect patterns and seasonality
      const patterns = this.detectPatterns(historicalData);
      
      // Generate base forecast
      const baseForecast = await this.generateBaseForecast(
        historicalData,
        request.horizon,
        patterns
      );

      // Apply external factors if provided
      const adjustedForecast = request.externalFactors
        ? this.applyExternalFactors(baseForecast, request.externalFactors)
        : baseForecast;

      // Calculate confidence intervals
      const predictions = this.calculateConfidenceIntervals(
        adjustedForecast,
        historicalData
      );

      // Identify forecast factors
      const factors = request.includeFactors
        ? await this.identifyForecastFactors(request.productId, patterns)
        : [];

      // Get model accuracy
      const accuracy = await this.getModelAccuracy(request.productId);

      const forecast: Forecast = {
        id: `forecast-${Date.now()}`,
        productId: request.productId,
        warehouseId: request.warehouseId,
        predictions,
        confidence: this.calculateOverallConfidence(predictions),
        modelAccuracy: accuracy,
        generatedAt: new Date(),
        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), // Valid for 24 hours
        factors
      };

      // Cache the forecast
      await this.cache.set(cacheKey, forecast, 3600); // 1 hour TTL
      this.forecastCache.set(forecast.id, forecast);

      // Emit event
      await this.eventBus.emit('ForecastGenerated', {
        forecastId: forecast.id,
        productId: request.productId,
        horizon: request.horizon
      });

      return forecast;
    } catch (error) {
      console.error('Error generating forecast:', error);
      throw error;
    }
  }

  /**
   * Get historical demand data
   */
  private async getHistoricalData(
    productId: string,
    warehouseId?: string
  ): Promise<HistoricalData[]> {
    const query = `
      SELECT 
        date,
        SUM(quantity_sold) as quantity,
        AVG(unit_price) as price,
        array_agg(DISTINCT promotion_id) as promotions
      FROM sales_history
      WHERE product_id = $1
        ${warehouseId ? 'AND warehouse_id = $2' : ''}
        AND date >= NOW() - INTERVAL '2 years'
      GROUP BY date
      ORDER BY date ASC
    `;

    const params = warehouseId ? [productId, warehouseId] : [productId];
    const result = await this.database.query(query, params);

    return result.rows.map(row => ({
      date: row.date,
      quantity: row.quantity,
      price: row.price,
      promotions: row.promotions?.filter(p => p !== null) || [],
      seasonality: this.calculateSeasonalityIndex(row.date)
    }));
  }

  /**
   * Detect patterns in historical data
   */
  private detectPatterns(data: HistoricalData[]): any {
    const patterns = {
      trend: this.detectTrend(data),
      seasonality: this.detectSeasonality(data),
      cyclical: this.detectCyclicalPattern(data),
      volatility: this.calculateVolatility(data)
    };

    return patterns;
  }

  /**
   * Generate base forecast using multiple models
   */
  private async generateBaseForecast(
    historicalData: HistoricalData[],
    horizon: number,
    patterns: any
  ): Promise<number[]> {
    // Use ensemble of models for better accuracy
    const models = [
      this.exponentialSmoothing(historicalData, horizon, patterns),
      this.arimaForecast(historicalData, horizon),
      this.prophetForecast(historicalData, horizon)
    ];

    const forecasts = await Promise.all(models);

    // Weighted average based on historical accuracy
    const weights = [0.3, 0.3, 0.4]; // Prophet gets higher weight
    const ensembleForecast = [];

    for (let i = 0; i < horizon; i++) {
      let weightedSum = 0;
      for (let j = 0; j < forecasts.length; j++) {
        weightedSum += forecasts[j][i] * weights[j];
      }
      ensembleForecast.push(Math.round(weightedSum));
    }

    return ensembleForecast;
  }

  /**
   * Exponential smoothing forecast
   */
  private exponentialSmoothing(
    data: HistoricalData[],
    horizon: number,
    patterns: any
  ): number[] {
    const alpha = 0.3; // Smoothing parameter
    const beta = 0.1;  // Trend parameter
    const gamma = 0.1; // Seasonal parameter
    
    const values = data.map(d => d.quantity);
    const seasonLength = 7; // Weekly seasonality
    
    // Initialize components
    let level = values[0];
    let trend = (values[1] - values[0]) / 1;
    const seasonal = new Array(seasonLength).fill(1);
    
    // Fit the model
    for (let i = 0; i < values.length; i++) {
      const seasonIndex = i % seasonLength;
      const lastLevel = level;
      
      level = alpha * (values[i] / seasonal[seasonIndex]) + 
              (1 - alpha) * (level + trend);
      trend = beta * (level - lastLevel) + (1 - beta) * trend;
      seasonal[seasonIndex] = gamma * (values[i] / level) + 
                             (1 - gamma) * seasonal[seasonIndex];
    }
    
    // Generate forecast
    const forecast = [];
    for (let h = 0; h < horizon; h++) {
      const seasonIndex = (values.length + h) % seasonLength;
      const forecastValue = (level + trend * (h + 1)) * seasonal[seasonIndex];
      forecast.push(Math.max(0, Math.round(forecastValue)));
    }
    
    return forecast;
  }

  /**
   * ARIMA forecast (simplified implementation)
   */
  private arimaForecast(data: HistoricalData[], horizon: number): number[] {
    const values = data.map(d => d.quantity);
    
    // Simple moving average as a proxy for ARIMA
    const windowSize = Math.min(7, Math.floor(values.length / 4));
    const ma = [];
    
    for (let i = windowSize - 1; i < values.length; i++) {
      let sum = 0;
      for (let j = 0; j < windowSize; j++) {
        sum += values[i - j];
      }
      ma.push(sum / windowSize);
    }
    
    // Calculate trend
    const trend = ma.length > 1 ? (ma[ma.length - 1] - ma[0]) / ma.length : 0;
    
    // Generate forecast
    const forecast = [];
    const lastMA = ma[ma.length - 1];
    
    for (let h = 0; h < horizon; h++) {
      const forecastValue = lastMA + trend * (h + 1);
      forecast.push(Math.max(0, Math.round(forecastValue)));
    }
    
    return forecast;
  }

  /**
   * Prophet-style forecast (simplified implementation)
   */
  private async prophetForecast(
    data: HistoricalData[],
    horizon: number
  ): Promise<number[]> {
    // In a real implementation, this would call the AI microservice
    // For now, we'll use a simplified version
    
    const values = data.map(d => d.quantity);
    const dates = data.map(d => d.date);
    
    // Decompose into trend and seasonal components
    const trendComponent = this.extractTrend(values);
    const seasonalComponent = this.extractSeasonality(values, dates);
    
    // Generate forecast
    const forecast = [];
    const lastValue = values[values.length - 1];
    const lastDate = dates[dates.length - 1];
    
    for (let h = 0; h < horizon; h++) {
      const futureDate = new Date(lastDate);
      futureDate.setDate(futureDate.getDate() + h + 1);
      
      // Combine trend and seasonality
      const trendValue = trendComponent.slope * (values.length + h) + trendComponent.intercept;
      const seasonalValue = this.getSeasonalValue(futureDate, seasonalComponent);
      
      const forecastValue = trendValue * seasonalValue;
      forecast.push(Math.max(0, Math.round(forecastValue)));
    }
    
    return forecast;
  }

  /**
   * Apply external factors to forecast
   */
  private applyExternalFactors(
    baseForecast: number[],
    factors: Record<string, any>
  ): number[] {
    const adjusted = [...baseForecast];
    
    // Apply promotional effects
    if (factors.promotions) {
      factors.promotions.forEach((promo: any) => {
        const startDay = promo.startDay || 0;
        const endDay = promo.endDay || adjusted.length - 1;
        const lift = promo.lift || 1.2; // 20% increase by default
        
        for (let i = startDay; i <= endDay && i < adjusted.length; i++) {
          adjusted[i] = Math.round(adjusted[i] * lift);
        }
      });
    }
    
    // Apply price elasticity
    if (factors.priceChange) {
      const elasticity = factors.elasticity || -1.2; // Default price elasticity
      const priceChangePercent = factors.priceChange;
      const demandChange = 1 + (elasticity * priceChangePercent / 100);
      
      for (let i = 0; i < adjusted.length; i++) {
        adjusted[i] = Math.round(adjusted[i] * demandChange);
      }
    }
    
    // Apply competitor effects
    if (factors.competitorActivity) {
      const impact = factors.competitorActivity.impact || 0.9; // 10% reduction
      for (let i = 0; i < adjusted.length; i++) {
        adjusted[i] = Math.round(adjusted[i] * impact);
      }
    }
    
    return adjusted;
  }

  /**
   * Calculate confidence intervals
   */
  private calculateConfidenceIntervals(
    forecast: number[],
    historicalData: HistoricalData[]
  ): ForecastPrediction[] {
    // Calculate historical forecast error
    const mape = this.calculateMAPE(historicalData);
    const errorMargin = mape / 100;
    
    const predictions: ForecastPrediction[] = [];
    const today = new Date();
    
    for (let i = 0; i < forecast.length; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i + 1);
      
      // Confidence intervals widen as we forecast further out
      const uncertaintyFactor = 1 + (i * 0.02); // 2% increase per day
      const margin = errorMargin * uncertaintyFactor;
      
      predictions.push({
        date,
        quantity: forecast[i],
        confidenceInterval: {
          lower: Math.max(0, Math.round(forecast[i] * (1 - margin))),
          upper: Math.round(forecast[i] * (1 + margin))
        }
      });
    }
    
    return predictions;
  }

  /**
   * Identify factors affecting the forecast
   */
  private async identifyForecastFactors(
    productId: string,
    patterns: any
  ): Promise<ForecastFactor[]> {
    const factors: ForecastFactor[] = [];
    
    // Trend factor
    if (Math.abs(patterns.trend.slope) > 0.01) {
      factors.push({
        name: patterns.trend.slope > 0 ? 'Upward Trend' : 'Downward Trend',
        impact: patterns.trend.slope,
        type: 'trend'
      });
    }
    
    // Seasonality factor
    if (patterns.seasonality.strength > 0.2) {
      factors.push({
        name: 'Weekly Seasonality',
        impact: patterns.seasonality.strength,
        type: 'seasonal'
      });
    }
    
    // Check for promotional effects
    const promoEffect = await this.getPromotionalEffect(productId);
    if (promoEffect > 0.1) {
      factors.push({
        name: 'Promotional Activity',
        impact: promoEffect,
        type: 'promotional'
      });
    }
    
    // Check for external factors
    const externalFactors = await this.getExternalFactors(productId);
    factors.push(...externalFactors);
    
    return factors;
  }

  /**
   * Get promotional effect on sales
   */
  private async getPromotionalEffect(productId: string): Promise<number> {
    const query = `
      SELECT 
        AVG(CASE WHEN promotion_id IS NOT NULL THEN quantity_sold ELSE 0 END) as promo_avg,
        AVG(CASE WHEN promotion_id IS NULL THEN quantity_sold ELSE 0 END) as normal_avg
      FROM sales_history
      WHERE product_id = $1
        AND date >= NOW() - INTERVAL '6 months'
    `;
    
    const result = await this.database.query(query, [productId]);
    const { promo_avg, normal_avg } = result.rows[0];
    
    if (normal_avg > 0) {
      return (promo_avg - normal_avg) / normal_avg;
    }
    
    return 0;
  }

  /**
   * Get external factors affecting demand
   */
  private async getExternalFactors(productId: string): Promise<ForecastFactor[]> {
    const factors: ForecastFactor[] = [];
    
    // Check for competitor activity
    const competitorImpact = await this.getCompetitorImpact(productId);
    if (Math.abs(competitorImpact) > 0.05) {
      factors.push({
        name: 'Competitor Activity',
        impact: competitorImpact,
        type: 'external'
      });
    }
    
    // Check for market trends
    const marketTrend = await this.getMarketTrend(productId);
    if (Math.abs(marketTrend) > 0.1) {
      factors.push({
        name: 'Market Trend',
        impact: marketTrend,
        type: 'external'
      });
    }
    
    return factors;
  }

  /**
   * Calculate overall confidence in the forecast
   */
  private calculateOverallConfidence(predictions: ForecastPrediction[]): number {
    // Base confidence on model accuracy and prediction interval width
    let totalConfidence = 0;
    
    for (const pred of predictions) {
      const intervalWidth = pred.confidenceInterval.upper - pred.confidenceInterval.lower;
      const relativeWidth = intervalWidth / pred.quantity;
      const confidence = Math.max(0, 1 - relativeWidth) * 100;
      totalConfidence += confidence;
    }
    
    return Math.round(totalConfidence / predictions.length);
  }

  /**
   * Get model accuracy for a product
   */
  private async getModelAccuracy(productId: string): Promise<number> {
    // Check cache
    if (this.modelAccuracy.has(productId)) {
      return this.modelAccuracy.get(productId)!;
    }
    
    // Calculate from historical forecast accuracy
    const query = `
      SELECT 
        AVG(1 - ABS(forecasted - actual) / NULLIF(actual, 0)) * 100 as accuracy
      FROM forecast_accuracy
      WHERE product_id = $1
        AND date >= NOW() - INTERVAL '3 months'
    `;
    
    const result = await this.database.query(query, [productId]);
    const accuracy = result.rows[0]?.accuracy || 85; // Default 85%
    
    this.modelAccuracy.set(productId, accuracy);
    return accuracy;
  }

  /**
   * Update forecast accuracy after actual sales
   */
  async updateForecastAccuracy(
    productId: string,
    date: Date,
    forecasted: number,
    actual: number
  ): Promise<void> {
    try {
      await this.database.query(
        `INSERT INTO forecast_accuracy (product_id, date, forecasted, actual)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, date) DO UPDATE
         SET forecasted = $3, actual = $4`,
        [productId, date, forecasted, actual]
      );
      
      // Recalculate model accuracy
      this.modelAccuracy.delete(productId);
      await this.getModelAccuracy(productId);
      
    } catch (error) {
      console.error('Error updating forecast accuracy:', error);
    }
  }

  /**
   * Helper methods
   */
  
  private calculateSeasonalityIndex(date: Date): number {
    // Simple weekly seasonality
    const dayOfWeek = date.getDay();
    const seasonalityMap = [0.8, 0.9, 1.0, 1.1, 1.3, 1.4, 1.2]; // Sun-Sat
    return seasonalityMap[dayOfWeek];
  }

  private detectTrend(data: HistoricalData[]): any {
    const values = data.map(d => d.quantity);
    const n = values.length;
    
    // Simple linear regression
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { slope, intercept };
  }

  private detectSeasonality(data: HistoricalData[]): any {
    // Detect weekly seasonality
    const dayAverages = new Array(7).fill(0);
    const dayCounts = new Array(7).fill(0);
    
    data.forEach(d => {
      const dayOfWeek = d.date.getDay();
      dayAverages[dayOfWeek] += d.quantity;
      dayCounts[dayOfWeek]++;
    });
    
    // Calculate averages
    for (let i = 0; i < 7; i++) {
      if (dayCounts[i] > 0) {
        dayAverages[i] /= dayCounts[i];
      }
    }
    
    // Calculate strength of seasonality
    const overallAvg = data.reduce((sum, d) => sum + d.quantity, 0) / data.length;
    const variance = dayAverages.reduce((sum, avg) => sum + Math.pow(avg - overallAvg, 2), 0) / 7;
    const strength = Math.sqrt(variance) / overallAvg;
    
    return { dayAverages, strength };
  }

  private detectCyclicalPattern(data: HistoricalData[]): any {
    // Simplified cyclical pattern detection
    // In production, would use FFT or other spectral analysis
    return { hasCycle: false, period: 0 };
  }

  private calculateVolatility(data: HistoricalData[]): number {
    const values = data.map(d => d.quantity);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance) / mean; // Coefficient of variation
  }

  private extractTrend(values: number[]): any {
    return this.detectTrend(values.map((v, i) => ({ 
      date: new Date(), 
      quantity: v 
    } as HistoricalData)));
  }

  private extractSeasonality(values: number[], dates: Date[]): any {
    const data = values.map((v, i) => ({
      date: dates[i],
      quantity: v
    } as HistoricalData));
    return this.detectSeasonality(data);
  }

  private getSeasonalValue(date: Date, seasonalComponent: any): number {
    const dayOfWeek = date.getDay();
    return seasonalComponent.dayAverages[dayOfWeek] / 
           (seasonalComponent.dayAverages.reduce((a, b) => a + b, 0) / 7);
  }

  private calculateMAPE(data: HistoricalData[]): number {
    // Mean Absolute Percentage Error
    // In production, would calculate from actual vs forecasted values
    return 15; // Default 15% error
  }

  private async getCompetitorImpact(productId: string): Promise<number> {
    // Simplified - in production would analyze competitor pricing and promotions
    return -0.05; // 5% negative impact
  }

  private async getMarketTrend(productId: string): Promise<number> {
    // Simplified - in production would analyze market data
    return 0.02; // 2% positive trend
  }

  isReady(): boolean {
    return true;
  }
}