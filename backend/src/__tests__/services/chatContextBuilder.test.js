const ChatContextBuilder = require('../../services/chatContextBuilder');
const Analytics = require('../../models/Analytics');
const Forecast = require('../../models/Forecast');
const Product = require('../../models/Product');
const Store = require('../../models/Store');
const User = require('../../models/User');
const Sale = require('../../models/Sale');
const { chatCache } = require('../../../config/redis');

// Mock all dependencies
jest.mock('../../models/Analytics');
jest.mock('../../models/Forecast');
jest.mock('../../models/Product');
jest.mock('../../models/Store');
jest.mock('../../models/User');
jest.mock('../../models/Sale');
jest.mock('../../../config/redis', () => ({
  chatCache: {
    getContext: jest.fn(),
    setContext: jest.fn()
  }
}));

describe('ChatContextBuilder', () => {
  let chatContextBuilder;
  const mockUserId = 'user-123';
  const mockStoreId = 'store-456';

  beforeEach(() => {
    chatContextBuilder = new ChatContextBuilder();
    jest.clearAllMocks();
  });

  describe('buildContext', () => {
    const mockUserData = {
      user_id: mockUserId,
      email: 'test@example.com',
      created_at: new Date('2024-01-01')
    };

    const mockStoreData = {
      store_id: mockStoreId,
      store_name: 'Test Store',
      business_type: 'retail',
      created_at: new Date('2024-01-01')
    };

    const mockStockAnalytics = [
      {
        product_id: 'prod-1',
        product_name: 'Widget A',
        sku: 'WID-001',
        current_stock: 50,
        reorder_point: 100,
        max_stock_level: 500,
        stock_status: 'low',
        days_of_supply_month: 15
      },
      {
        product_id: 'prod-2',
        product_name: 'Gadget B',
        sku: 'GAD-002',
        current_stock: 1000,
        reorder_point: 200,
        max_stock_level: 800,
        stock_status: 'overstock',
        days_of_supply_month: 120
      }
    ];

    const mockForecasts = [
      {
        product_id: 'prod-1',
        product_name: 'Widget A',
        sku: 'WID-001',
        current_stock: 50,
        predicted_demand: 150,
        confidence_level: 'high',
        forecast_date: new Date('2024-02-01')
      }
    ];

    const mockReorderSuggestions = [
      {
        product_id: 'prod-1',
        product_name: 'Widget A',
        sku: 'WID-001',
        current_stock: 50,
        suggested_reorder_amount: 100
      }
    ];

    const mockDashboardMetrics = {
      summary: {
        totalProducts: 100,
        criticalStockProducts: 5,
        lowStockProducts: 10,
        overstockProducts: 3,
        totalInventoryValue: 50000,
        avgTurnoverRatio: 4.5
      }
    };

    beforeEach(() => {
      // Setup default mocks
      User.findById.mockResolvedValue(mockUserData);
      Store.findById.mockResolvedValue(mockStoreData);
      Analytics.getStockLevelAnalytics.mockResolvedValue(mockStockAnalytics);
      Analytics.calculateCarryingCosts.mockResolvedValue([
        { inventory_value: 25000 },
        { inventory_value: 25000 }
      ]);
      Analytics.calculateInventoryTurnover.mockResolvedValue([
        { 
          product_id: 'prod-1',
          product_name: 'Widget A',
          sku: 'WID-001',
          turnover_ratio: 6,
          performance_category: 'excellent'
        }
      ]);
      Analytics.calculateStockoutRate.mockResolvedValue([]);
      Analytics.getDashboardMetrics.mockResolvedValue(mockDashboardMetrics);
      
      Forecast.getReorderSuggestions.mockResolvedValue(mockReorderSuggestions);
      Forecast.getLatestForecasts.mockResolvedValue(mockForecasts);
      
      Sale.getHistoricalSalesByMonth.mockResolvedValue([
        { month: 1, avg_daily_sales: 100, total_revenue: 3000 },
        { month: 2, avg_daily_sales: 150, total_revenue: 4500 }
      ]);
      Sale.getSalesTrends.mockResolvedValue([
        { sale_date: '2024-01-01', daily_revenue: 1000 },
        { sale_date: '2024-01-02', daily_revenue: 1200 }
      ]);
      
      chatCache.getContext.mockResolvedValue(null);
    });

    it('should aggregate data from multiple sources', async () => {
      const userMessage = 'What is the inventory status?';
      
      const context = await chatContextBuilder.buildContext(
        mockUserId,
        mockStoreId,
        userMessage
      );

      // Verify all services were called
      expect(User.findById).toHaveBeenCalledWith(mockUserId);
      expect(Store.findById).toHaveBeenCalledWith(mockStoreId);
      expect(Analytics.getStockLevelAnalytics).toHaveBeenCalledWith(mockStoreId);
      expect(Analytics.getDashboardMetrics).toHaveBeenCalledWith(mockStoreId);
      expect(Forecast.getLatestForecasts).toHaveBeenCalledWith(mockStoreId, 30);
      expect(Sale.getHistoricalSalesByMonth).toHaveBeenCalledWith(mockStoreId);
      expect(Sale.getSalesTrends).toHaveBeenCalledWith(mockStoreId, 30);

      // Verify context structure
      expect(context).toHaveProperty('user');
      expect(context).toHaveProperty('store');
      expect(context).toHaveProperty('inventory');
      expect(context).toHaveProperty('forecasts');
      expect(context).toHaveProperty('seasonalPatterns');
      expect(context).toHaveProperty('salesTrends');
      expect(context).toHaveProperty('dashboardMetrics');
      expect(context).toHaveProperty('timestamp');
    });

    it('should use cached context when available', async () => {
      const cachedContext = {
        user: { userId: mockUserId },
        store: { storeId: mockStoreId },
        timestamp: new Date()
      };
      
      chatCache.getContext.mockResolvedValue(cachedContext);

      const context = await chatContextBuilder.buildContext(
        mockUserId,
        mockStoreId,
        'test message'
      );

      expect(context).toEqual(cachedContext);
      expect(User.findById).not.toHaveBeenCalled();
      expect(Store.findById).not.toHaveBeenCalled();
    });

    it('should handle service failures gracefully', async () => {
      User.findById.mockRejectedValue(new Error('User not found'));

      await expect(
        chatContextBuilder.buildContext(mockUserId, mockStoreId, 'test')
      ).rejects.toThrow('Failed to build context for chat response');
    });

    it('should cache the built context', async () => {
      await chatContextBuilder.buildContext(
        mockUserId,
        mockStoreId,
        'test message'
      );

      expect(chatCache.setContext).toHaveBeenCalledWith(
        mockUserId,
        mockStoreId,
        expect.objectContaining({
          user: expect.any(Object),
          store: expect.any(Object),
          timestamp: expect.any(Date)
        })
      );
    });
  });

  describe('filterRelevantData', () => {
    const mockData = {
      forecasts: [
        { productId: '1', productName: 'Widget A', sku: 'WID-001' },
        { productId: '2', productName: 'Gadget B', sku: 'GAD-002' },
        { productId: '3', productName: 'Tool C', sku: 'TOL-003' }
      ],
      inventory: {
        lowStockProducts: [
          { productId: '1', productName: 'Widget A' },
          { productId: '2', productName: 'Gadget B' }
        ],
        reorderSuggestions: [
          { product_id: '1', product_name: 'Widget A' },
          { product_id: '3', product_name: 'Tool C' }
        ]
      },
      recentEvents: [
        { productName: 'Widget A', type: 'stockout' },
        { productName: 'Gadget B', type: 'stockout' }
      ],
      seasonalPatterns: [],
      salesTrends: {}
    };

    it('should filter data based on product mentions', () => {
      const result = chatContextBuilder.filterRelevantData(
        mockData,
        'Tell me about Widget A'
      );

      expect(result.forecasts).toHaveLength(1);
      expect(result.forecasts[0].productName).toBe('Widget A');
      expect(result.inventory.lowStockProducts).toHaveLength(1);
      expect(result.inventory.reorderSuggestions).toHaveLength(1);
      expect(result.recentEvents).toHaveLength(1);
    });

    it('should return summary data when no specific products mentioned', () => {
      const result = chatContextBuilder.filterRelevantData(
        mockData,
        'What is the general inventory status?'
      );

      expect(result.forecasts).toHaveLength(3); // Top 5, but we only have 3
      expect(result.inventory).toBeDefined();
    });
  });

  describe('extractKeywords', () => {
    it('should extract meaningful keywords from message', () => {
      const keywords = chatContextBuilder.extractKeywords(
        'what is the reorder status for widget a and gadget b'
      );

      expect(keywords).toContain('reorder');
      expect(keywords).toContain('widget');
      expect(keywords).toContain('gadget');
      expect(keywords).toContain('status');
      expect(keywords).not.toContain('what');
      expect(keywords).not.toContain('the');
      expect(keywords).not.toContain('for');
      expect(keywords).not.toContain('and');
    });

    it('should include action keywords when present', () => {
      const keywords = chatContextBuilder.extractKeywords(
        'show me the seasonal forecast trends'
      );

      expect(keywords).toContain('seasonal');
      expect(keywords).toContain('forecast');
      expect(keywords).toContain('show');
      expect(keywords).toContain('trends');
    });
  });

  describe('getInventorySnapshot', () => {
    it('should correctly categorize products by stock status', async () => {
      const mockStockData = [
        { 
          product_id: '1', 
          product_name: 'Product 1', 
          stock_status: 'critical',
          current_stock: 10,
          reorder_point: 50
        },
        { 
          product_id: '2', 
          product_name: 'Product 2', 
          stock_status: 'overstock',
          current_stock: 1000,
          max_stock_level: 500
        }
      ];

      Analytics.getStockLevelAnalytics.mockResolvedValue(mockStockData);
      Analytics.calculateCarryingCosts.mockResolvedValue([
        { inventory_value: 5000 }
      ]);
      Analytics.calculateInventoryTurnover.mockResolvedValue([]);
      Forecast.getReorderSuggestions.mockResolvedValue([]);

      const snapshot = await chatContextBuilder.getInventorySnapshot(mockStoreId);

      expect(snapshot.totalProducts).toBe(2);
      expect(snapshot.lowStockProducts).toHaveLength(1);
      expect(snapshot.overstockProducts).toHaveLength(1);
      expect(snapshot.inventoryValue).toBe(5000);
    });

    it('should handle errors gracefully', async () => {
      Analytics.getStockLevelAnalytics.mockRejectedValue(new Error('DB Error'));

      const snapshot = await chatContextBuilder.getInventorySnapshot(mockStoreId);

      expect(snapshot).toEqual({
        totalProducts: 0,
        lowStockProducts: [],
        overstockProducts: [],
        reorderSuggestions: [],
        inventoryValue: 0,
        topPerformers: []
      });
    });
  });

  describe('getSeasonalPatterns', () => {
    it('should identify significant seasonal patterns', async () => {
      const mockSalesData = [
        { month: 1, avg_daily_sales: 100, total_revenue: 3100 },
        { month: 2, avg_daily_sales: 150, total_revenue: 4200 }, // 50% higher
        { month: 3, avg_daily_sales: 90, total_revenue: 2790 },
        { month: 12, avg_daily_sales: 200, total_revenue: 6200 } // 100% higher
      ];

      Sale.getHistoricalSalesByMonth.mockResolvedValue(mockSalesData);

      const patterns = await chatContextBuilder.getSeasonalPatterns(mockStoreId);

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0]).toHaveProperty('period');
      expect(patterns[0]).toHaveProperty('impact');
      expect(patterns[0]).toHaveProperty('description');
      
      // December should have the highest impact
      const decemberPattern = patterns.find(p => p.period === 'December');
      expect(decemberPattern).toBeDefined();
      expect(Math.abs(decemberPattern.impact)).toBeGreaterThan(40); // Adjusted threshold
    });
  });

  describe('getSalesTrends', () => {
    it('should calculate trend direction correctly', async () => {
      const mockTrendData = [
        { sale_date: '2024-01-01', daily_revenue: 1000 },
        { sale_date: '2024-01-02', daily_revenue: 1100 },
        { sale_date: '2024-01-03', daily_revenue: 1200 },
        { sale_date: '2024-01-04', daily_revenue: 1300 },
        { sale_date: '2024-01-05', daily_revenue: 1400 },
        { sale_date: '2024-01-06', daily_revenue: 1500 },
        { sale_date: '2024-01-07', daily_revenue: 1600 },
        // Add more days to ensure significant trend
        { sale_date: '2024-01-08', daily_revenue: 1700 },
        { sale_date: '2024-01-09', daily_revenue: 1800 },
        { sale_date: '2024-01-10', daily_revenue: 1900 },
        { sale_date: '2024-01-11', daily_revenue: 2000 },
        { sale_date: '2024-01-12', daily_revenue: 2100 },
        { sale_date: '2024-01-13', daily_revenue: 2200 },
        { sale_date: '2024-01-14', daily_revenue: 2300 }
      ];

      Sale.getSalesTrends.mockResolvedValue(mockTrendData);

      const trends = await chatContextBuilder.getSalesTrends(mockStoreId, 14);

      expect(trends.direction).toBe('up');
      expect(trends.percentage).toBeGreaterThan(50); // Significant increase
      expect(trends.dataPoints).toBe(14);
    });

    it('should handle empty sales data', async () => {
      Sale.getSalesTrends.mockResolvedValue([]);

      const trends = await chatContextBuilder.getSalesTrends(mockStoreId, 30);

      expect(trends.direction).toBe('stable');
      expect(trends.percentage).toBe(0);
      expect(trends.dataPoints).toBe(0);
    });
  });

  describe('helper methods', () => {
    it('should map confidence levels to percentages', () => {
      expect(chatContextBuilder.mapConfidenceToPercentage('high')).toBe(85);
      expect(chatContextBuilder.mapConfidenceToPercentage('medium')).toBe(65);
      expect(chatContextBuilder.mapConfidenceToPercentage('low')).toBe(45);
      expect(chatContextBuilder.mapConfidenceToPercentage('unknown')).toBe(50);
    });

    it('should identify risk factors correctly', () => {
      const forecast1 = {
        confidence_level: 'low',
        current_stock: 50,
        predicted_demand: 100
      };
      
      const risks1 = chatContextBuilder.identifyRiskFactors(forecast1);
      expect(risks1).toContain('Low confidence forecast');
      expect(risks1).toContain('Potential stockout risk');

      const forecast2 = {
        confidence_level: 'high',
        current_stock: 100,
        predicted_demand: 0
      };
      
      const risks2 = chatContextBuilder.identifyRiskFactors(forecast2);
      expect(risks2).toContain('No demand predicted');
    });

    it('should get month names correctly', () => {
      expect(chatContextBuilder.getMonthName(0)).toBe('January');
      expect(chatContextBuilder.getMonthName(11)).toBe('December');
      expect(chatContextBuilder.getMonthName(12)).toBe('Unknown');
    });
  });
});