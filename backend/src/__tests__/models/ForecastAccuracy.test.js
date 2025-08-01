const ForecastAccuracy = require('../../models/ForecastAccuracy');
const { mockDb, resetMockDb, setupMockQuery } = require('../setup/testDb');

// Mock the database module
jest.mock('../../../../config/database', () => ({
  query: (...args) => mockDb.query(...args),
}));

describe('ForecastAccuracy Model - Ticket #2', () => {
  beforeEach(() => {
    resetMockDb();
  });

  describe('recordAccuracy', () => {
    it('should record forecast accuracy correctly', async () => {
      const accuracyData = {
        productId: 'prod-1',
        forecastDate: '2024-01-15',
        predictedDemand: 100,
        actualDemand: 95,
        modelUsed: 'prophet',
      };

      setupMockQuery([[{ accuracy_id: 'acc-1' }]]);

      const result = await ForecastAccuracy.recordAccuracy(accuracyData);

      expect(mockDb.query).toHaveBeenCalledTimes(1);
      expect(result.accuracy_id).toBe('acc-1');
      
      // Verify the SQL query includes the correct parameters
      const queryCall = mockDb.query.mock.calls[0];
      expect(queryCall[1]).toContain(accuracyData.productId);
      expect(queryCall[1]).toContain(accuracyData.predictedDemand);
      expect(queryCall[1]).toContain(accuracyData.actualDemand);
    });
  });

  describe('getAccuracyMetrics', () => {
    it('should calculate accuracy metrics for a product', async () => {
      const productId = 'prod-1';
      const period = 30;

      const metricsData = [{
        mean_absolute_error: 5.2,
        mean_absolute_percentage_error: 8.5,
        root_mean_square_error: 6.8,
        forecast_bias: -2.1,
        accuracy_percentage: 91.5,
        total_forecasts: 30,
      }];

      setupMockQuery([metricsData]);

      const result = await ForecastAccuracy.getAccuracyMetrics(productId, period);

      expect(result.mae).toBe(5.2);
      expect(result.mape).toBe(8.5);
      expect(result.rmse).toBe(6.8);
      expect(result.bias).toBe(-2.1);
      expect(result.accuracy).toBe(91.5);
    });
  });

  describe('getStoreAccuracyMetrics', () => {
    it('should aggregate accuracy metrics for entire store', async () => {
      const storeId = 'test-store-id';
      const groupBy = 'category';

      const storeMetricsData = [
        {
          category: 'Electronics',
          avg_mae: 4.5,
          avg_mape: 7.2,
          avg_rmse: 5.8,
          avg_bias: -1.5,
          avg_accuracy: 92.8,
          product_count: 15,
        },
        {
          category: 'Clothing',
          avg_mae: 6.2,
          avg_mape: 10.5,
          avg_rmse: 8.1,
          avg_bias: 2.3,
          avg_accuracy: 89.5,
          product_count: 25,
        },
      ];

      setupMockQuery([storeMetricsData]);

      const result = await ForecastAccuracy.getStoreAccuracyMetrics(storeId, groupBy);

      expect(result).toHaveLength(2);
      expect(result[0].category).toBe('Electronics');
      expect(result[0].avg_accuracy).toBe(92.8);
      expect(result[1].category).toBe('Clothing');
      expect(result[1].avg_accuracy).toBe(89.5);
    });
  });

  describe('getProductsNeedingAttention', () => {
    it('should identify products with poor forecast accuracy', async () => {
      const storeId = 'test-store-id';
      const accuracyThreshold = 85;
      const minForecasts = 5;

      const poorPerformersData = [
        {
          product_id: 'prod-1',
          product_name: 'Poor Forecast Product',
          sku: 'SKU001',
          avg_accuracy: 78.5,
          total_forecasts: 20,
          avg_mape: 21.5,
          latest_accuracy: 75.2,
        },
        {
          product_id: 'prod-2',
          product_name: 'Very Poor Forecast Product',
          sku: 'SKU002',
          avg_accuracy: 65.3,
          total_forecasts: 15,
          avg_mape: 34.7,
          latest_accuracy: 62.1,
        },
      ];

      setupMockQuery([poorPerformersData]);

      const result = await ForecastAccuracy.getProductsNeedingAttention(
        storeId,
        accuracyThreshold,
        minForecasts
      );

      expect(result).toHaveLength(2);
      expect(result[0].avg_accuracy).toBeLessThan(accuracyThreshold);
      expect(result[1].avg_accuracy).toBeLessThan(result[0].avg_accuracy);
    });
  });

  describe('getModelComparison', () => {
    it('should compare performance across different models', async () => {
      const storeId = 'test-store-id';

      const modelComparisonData = [
        {
          model_used: 'prophet',
          avg_accuracy: 88.5,
          avg_mape: 11.5,
          avg_rmse: 15.2,
          forecast_count: 150,
          products_used: 30,
        },
        {
          model_used: 'arima',
          avg_accuracy: 85.2,
          avg_mape: 14.8,
          avg_rmse: 18.5,
          forecast_count: 120,
          products_used: 25,
        },
        {
          model_used: 'lstm',
          avg_accuracy: 91.3,
          avg_mape: 8.7,
          avg_rmse: 12.1,
          forecast_count: 80,
          products_used: 20,
        },
      ];

      setupMockQuery([modelComparisonData]);

      const result = await ForecastAccuracy.getModelComparison(storeId);

      expect(result).toHaveLength(3);
      expect(result[0].model_used).toBe('prophet');
      expect(result[2].model_used).toBe('lstm');
      expect(result[2].avg_accuracy).toBeGreaterThan(result[0].avg_accuracy);
    });
  });

  describe('updateAccuracyWithActualSales', () => {
    it('should update forecast accuracy when actual sales data arrives', async () => {
      const storeId = 'test-store-id';
      const date = '2024-01-15';

      // Mock finding forecasts and sales data
      const forecastsData = [
        {
          product_id: 'prod-1',
          forecast_date: '2024-01-15',
          predicted_demand: 100,
        },
        {
          product_id: 'prod-2',
          forecast_date: '2024-01-15',
          predicted_demand: 50,
        },
      ];

      const salesData = [
        {
          product_id: 'prod-1',
          actual_demand: 95,
        },
        {
          product_id: 'prod-2',
          actual_demand: 55,
        },
      ];

      setupMockQuery([
        forecastsData, // getForecastsForDate
        salesData, // getActualSalesForDate
        [{ accuracy_id: 'acc-1' }], // recordAccuracy for prod-1
        [{ accuracy_id: 'acc-2' }], // recordAccuracy for prod-2
      ]);

      const result = await ForecastAccuracy.updateAccuracyWithActualSales(storeId, date);

      expect(result.updated).toBe(2);
      expect(mockDb.query).toHaveBeenCalledTimes(4);
    });
  });
});