/**
 * Forecast Service Tests
 */

import { ForecastService } from '../../services/forecast.service';
import { Forecast } from '../../types';

describe('ForecastService', () => {
  let service: ForecastService;
  let mockDatabase: any;
  let mockCache: any;
  let mockEventBus: any;

  beforeEach(() => {
    mockDatabase = {
      query: jest.fn()
    };

    mockCache = {
      get: jest.fn(),
      set: jest.fn()
    };

    mockEventBus = {
      emit: jest.fn()
    };

    service = new ForecastService(mockDatabase, mockCache, mockEventBus);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateForecast', () => {
    it('should generate forecast for a product', async () => {
      // Mock historical data
      const historicalData = Array.from({ length: 60 }, (_, i) => ({
        date: new Date(2024, 0, i + 1),
        quantity: 100 + Math.sin(i / 7) * 20, // Simulate weekly pattern
        price: 50,
        promotions: [],
        seasonality_index: 1
      }));

      mockDatabase.query.mockImplementation((query: string) => {
        if (query.includes('sales_history')) {
          return { rows: historicalData };
        }
        if (query.includes('forecast_accuracy')) {
          return { rows: [{ accuracy: 90 }] };
        }
        return { rows: [] };
      });

      mockCache.get.mockResolvedValue(null);

      const request = {
        productId: 'prod-1',
        horizon: 7,
        includeFactors: true
      };

      const forecast = await service.generateForecast(request);

      expect(forecast).toMatchObject({
        productId: 'prod-1',
        predictions: expect.any(Array),
        confidence: expect.any(Number),
        modelAccuracy: expect.any(Number),
        factors: expect.any(Array)
      });

      expect(forecast.predictions).toHaveLength(7);
      expect(forecast.predictions[0]).toMatchObject({
        date: expect.any(Date),
        quantity: expect.any(Number),
        confidenceInterval: {
          lower: expect.any(Number),
          upper: expect.any(Number)
        }
      });

      expect(mockCache.set).toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalledWith('ForecastGenerated', expect.any(Object));
    });

    it('should return cached forecast if available', async () => {
      const cachedForecast: Forecast = {
        id: 'forecast-1',
        productId: 'prod-1',
        predictions: [],
        confidence: 85,
        modelAccuracy: 90,
        generatedAt: new Date(),
        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
        factors: []
      };

      mockCache.get.mockResolvedValue(cachedForecast);

      const request = {
        productId: 'prod-1',
        horizon: 7
      };

      const forecast = await service.generateForecast(request);

      expect(forecast).toEqual(cachedForecast);
      expect(mockDatabase.query).not.toHaveBeenCalled();
    });

    it('should throw error if insufficient historical data', async () => {
      mockDatabase.query.mockResolvedValue({ rows: [] }); // No historical data
      mockCache.get.mockResolvedValue(null);

      const request = {
        productId: 'prod-1',
        horizon: 7
      };

      await expect(service.generateForecast(request)).rejects.toThrow(
        'Insufficient historical data for forecasting'
      );
    });

    it('should apply external factors to forecast', async () => {
      const historicalData = Array.from({ length: 60 }, (_, i) => ({
        date: new Date(2024, 0, i + 1),
        quantity: 100,
        price: 50,
        promotions: []
      }));

      mockDatabase.query.mockResolvedValue({ rows: historicalData });
      mockCache.get.mockResolvedValue(null);

      const request = {
        productId: 'prod-1',
        horizon: 7,
        externalFactors: {
          promotions: [{
            startDay: 2,
            endDay: 4,
            lift: 1.5
          }],
          priceChange: -10,
          elasticity: -1.5
        }
      };

      const forecast = await service.generateForecast(request);

      // Check that promotional days have higher predictions
      expect(forecast.predictions[2].quantity).toBeGreaterThan(forecast.predictions[0].quantity);
      expect(forecast.predictions[3].quantity).toBeGreaterThan(forecast.predictions[0].quantity);
      expect(forecast.predictions[4].quantity).toBeGreaterThan(forecast.predictions[0].quantity);
    });
  });

  describe('updateForecastAccuracy', () => {
    it('should update forecast accuracy in database', async () => {
      mockDatabase.query.mockResolvedValue({ rows: [] });

      await service.updateForecastAccuracy(
        'prod-1',
        new Date(2024, 0, 1),
        100,
        95
      );

      expect(mockDatabase.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO forecast_accuracy'),
        ['prod-1', new Date(2024, 0, 1), 100, 95]
      );
    });

    it('should handle database errors gracefully', async () => {
      mockDatabase.query.mockRejectedValue(new Error('Database error'));

      await service.updateForecastAccuracy(
        'prod-1',
        new Date(2024, 0, 1),
        100,
        95
      );

      // Should not throw, just log error
      expect(mockDatabase.query).toHaveBeenCalled();
    });
  });

  describe('Pattern Detection', () => {
    it('should detect trend in historical data', async () => {
      // Create data with clear upward trend
      const trendData = Array.from({ length: 30 }, (_, i) => ({
        date: new Date(2024, 0, i + 1),
        quantity: 100 + i * 2, // Linear growth
        price: 50,
        promotions: []
      }));

      mockDatabase.query.mockResolvedValue({ rows: trendData });
      mockCache.get.mockResolvedValue(null);

      const forecast = await service.generateForecast({
        productId: 'prod-1',
        horizon: 7,
        includeFactors: true
      });

      const trendFactor = forecast.factors.find(f => f.type === 'trend');
      expect(trendFactor).toBeDefined();
      expect(trendFactor?.name).toContain('Upward Trend');
      expect(trendFactor?.impact).toBeGreaterThan(0);
    });

    it('should detect seasonality in historical data', async () => {
      // Create data with weekly seasonality
      const seasonalData = Array.from({ length: 60 }, (_, i) => ({
        date: new Date(2024, 0, i + 1),
        quantity: 100 + Math.sin(i * 2 * Math.PI / 7) * 30, // Weekly pattern
        price: 50,
        promotions: []
      }));

      mockDatabase.query.mockResolvedValue({ rows: seasonalData });
      mockCache.get.mockResolvedValue(null);

      const forecast = await service.generateForecast({
        productId: 'prod-1',
        horizon: 7,
        includeFactors: true
      });

      const seasonalFactor = forecast.factors.find(f => f.type === 'seasonal');
      expect(seasonalFactor).toBeDefined();
      expect(seasonalFactor?.name).toContain('Seasonality');
    });
  });

  describe('Confidence Intervals', () => {
    it('should calculate widening confidence intervals', async () => {
      const historicalData = Array.from({ length: 60 }, (_, i) => ({
        date: new Date(2024, 0, i + 1),
        quantity: 100 + (Math.random() - 0.5) * 20,
        price: 50,
        promotions: []
      }));

      mockDatabase.query.mockResolvedValue({ rows: historicalData });
      mockCache.get.mockResolvedValue(null);

      const forecast = await service.generateForecast({
        productId: 'prod-1',
        horizon: 7
      });

      // Confidence intervals should widen as we go further out
      const firstInterval = forecast.predictions[0].confidenceInterval;
      const lastInterval = forecast.predictions[6].confidenceInterval;

      const firstWidth = firstInterval.upper - firstInterval.lower;
      const lastWidth = lastInterval.upper - lastInterval.lower;

      expect(lastWidth).toBeGreaterThan(firstWidth);
    });
  });

  describe('Model Accuracy', () => {
    it('should retrieve model accuracy from historical performance', async () => {
      mockDatabase.query.mockImplementation((query: string) => {
        if (query.includes('sales_history')) {
          return {
            rows: Array.from({ length: 60 }, (_, i) => ({
              date: new Date(2024, 0, i + 1),
              quantity: 100,
              price: 50,
              promotions: []
            }))
          };
        }
        if (query.includes('forecast_accuracy')) {
          return { rows: [{ accuracy: 88.5 }] };
        }
        return { rows: [] };
      });

      mockCache.get.mockResolvedValue(null);

      const forecast = await service.generateForecast({
        productId: 'prod-1',
        horizon: 7
      });

      expect(forecast.modelAccuracy).toBe(88.5);
    });

    it('should use default accuracy if no historical data', async () => {
      mockDatabase.query.mockImplementation((query: string) => {
        if (query.includes('sales_history')) {
          return {
            rows: Array.from({ length: 60 }, (_, i) => ({
              date: new Date(2024, 0, i + 1),
              quantity: 100,
              price: 50,
              promotions: []
            }))
          };
        }
        if (query.includes('forecast_accuracy')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      mockCache.get.mockResolvedValue(null);

      const forecast = await service.generateForecast({
        productId: 'prod-1',
        horizon: 7
      });

      expect(forecast.modelAccuracy).toBe(85); // Default value
    });
  });

  describe('isReady', () => {
    it('should always return true', () => {
      expect(service.isReady()).toBe(true);
    });
  });
});