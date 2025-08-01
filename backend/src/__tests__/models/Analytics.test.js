const Analytics = require("../../models/Analytics");
const { mockDb, resetMockDb, setupMockQuery } = require("../setup/testDb");

// Mock the database module
jest.mock("../../../config/database", () => ({
  query: (...args) => mockDb.query(...args),
}));

describe("Analytics Model - Ticket #1", () => {
  beforeEach(() => {
    resetMockDb();
  });

  describe("getInventoryTurnover", () => {
    it("should calculate inventory turnover correctly", async () => {
      const storeId = "test-store-id";
      const period = 30;

      // Mock data for inventory turnover calculation
      const mockData = [
        {
          product_id: "prod-1",
          product_name: "Test Product 1",
          sku: "SKU001",
          cogs: 10000,
          avg_inventory_value: 2500,
          turnover_rate: 4.0,
          performance_category: "Good",
          industry_benchmark: 6.0,
        },
        {
          product_id: "prod-2",
          product_name: "Test Product 2",
          sku: "SKU002",
          cogs: 5000,
          avg_inventory_value: 5000,
          turnover_rate: 1.0,
          performance_category: "Poor",
          industry_benchmark: 6.0,
        },
      ];

      setupMockQuery([mockData]);

      const result = await Analytics.getInventoryTurnover(storeId, period);

      expect(mockDb.query).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect(result[0].turnover_rate).toBe(4.0);
      expect(result[0].performance_category).toBe("Good");
      expect(result[1].turnover_rate).toBe(1.0);
      expect(result[1].performance_category).toBe("Poor");
    });

    it("should handle empty results gracefully", async () => {
      setupMockQuery([[]]);

      const result = await Analytics.getInventoryTurnover("store-id", 30);

      expect(result).toEqual([]);
    });
  });

  describe("getStockoutRate", () => {
    it("should calculate stockout rate with lost revenue", async () => {
      const storeId = "test-store-id";
      const period = 30;

      const mockData = [
        {
          product_id: "prod-1",
          product_name: "Test Product",
          sku: "SKU001",
          stockout_rate: 5.2,
          stockout_events: 3,
          total_days: 30,
          lost_revenue: 1500.0,
          avg_daily_demand: 10,
        },
      ];

      setupMockQuery([mockData]);

      const result = await Analytics.getStockoutRate(storeId, period);

      expect(result).toHaveLength(1);
      expect(result[0].stockout_rate).toBe(5.2);
      expect(result[0].lost_revenue).toBe(1500.0);
      expect(result[0].stockout_events).toBe(3);
    });
  });

  describe("getCarryingCosts", () => {
    it("should calculate carrying costs correctly", async () => {
      const storeId = "test-store-id";

      const mockData = [
        {
          product_id: "prod-1",
          product_name: "Test Product",
          sku: "SKU001",
          current_stock: 100,
          unit_cost: 50,
          inventory_value: 5000,
          storage_cost: 250,
          insurance_cost: 50,
          total_carrying_cost: 300,
          carrying_cost_percentage: 6.0,
        },
      ];

      setupMockQuery([mockData]);

      const result = await Analytics.getCarryingCosts(storeId);

      expect(result).toHaveLength(1);
      expect(result[0].total_carrying_cost).toBe(300);
      expect(result[0].carrying_cost_percentage).toBe(6.0);
    });
  });

  describe("getGrossMargins", () => {
    it("should calculate gross margins and rank products", async () => {
      const storeId = "test-store-id";
      const period = 30;

      const mockData = [
        {
          product_id: "prod-1",
          product_name: "High Margin Product",
          sku: "SKU001",
          total_revenue: 10000,
          total_cost: 6000,
          gross_margin: 4000,
          margin_percentage: 40.0,
          units_sold: 100,
          profit_rank: 1,
        },
        {
          product_id: "prod-2",
          product_name: "Low Margin Product",
          sku: "SKU002",
          total_revenue: 5000,
          total_cost: 4500,
          gross_margin: 500,
          margin_percentage: 10.0,
          units_sold: 50,
          profit_rank: 2,
        },
      ];

      setupMockQuery([mockData]);

      const result = await Analytics.getGrossMargins(storeId, period);

      expect(result).toHaveLength(2);
      expect(result[0].margin_percentage).toBe(40.0);
      expect(result[0].profit_rank).toBe(1);
      expect(result[1].margin_percentage).toBe(10.0);
      expect(result[1].profit_rank).toBe(2);
    });
  });

  describe("getStockLevels", () => {
    it("should analyze stock levels with status indicators", async () => {
      const storeId = "test-store-id";

      const mockData = [
        {
          product_id: "prod-1",
          product_name: "Critical Stock Product",
          sku: "SKU001",
          current_stock: 5,
          reorder_point: 20,
          max_stock_level: 100,
          stock_status: "critical",
          days_of_supply: 2,
          avg_daily_sales: 2.5,
        },
        {
          product_id: "prod-2",
          product_name: "Overstock Product",
          sku: "SKU002",
          current_stock: 200,
          reorder_point: 20,
          max_stock_level: 100,
          stock_status: "overstock",
          days_of_supply: 80,
          avg_daily_sales: 2.5,
        },
      ];

      setupMockQuery([mockData]);

      const result = await Analytics.getStockLevels(storeId);

      expect(result).toHaveLength(2);
      expect(result[0].stock_status).toBe("critical");
      expect(result[0].days_of_supply).toBe(2);
      expect(result[1].stock_status).toBe("overstock");
      expect(result[1].days_of_supply).toBe(80);
    });
  });

  describe("getDashboardMetrics", () => {
    it("should aggregate all dashboard metrics", async () => {
      const storeId = "test-store-id";

      // Mock responses for each metric query
      const turnoverData = [{ avg_turnover_rate: 4.5 }];
      const stockoutData = [
        { total_stockout_rate: 3.2, total_lost_revenue: 5000 },
      ];
      const carryingData = [
        { total_carrying_cost: 10000, avg_carrying_percentage: 5.5 },
      ];
      const marginData = [{ avg_margin_percentage: 35.0 }];
      const stockData = [
        { stock_status: "critical", count: "2" },
        { stock_status: "low", count: "5" },
        { stock_status: "optimal", count: "20" },
        { stock_status: "overstock", count: "3" },
      ];

      setupMockQuery([
        turnoverData,
        stockoutData,
        carryingData,
        marginData,
        stockData,
      ]);

      const result = await Analytics.getDashboardMetrics(storeId);

      expect(mockDb.query).toHaveBeenCalledTimes(5);
      expect(result.inventoryTurnover).toBe(4.5);
      expect(result.stockoutRate).toBe(3.2);
      expect(result.lostRevenue).toBe(5000);
      expect(result.carryingCostPercentage).toBe(5.5);
      expect(result.avgGrossMargin).toBe(35.0);
      expect(result.stockStatus.critical).toBe(2);
      expect(result.stockStatus.optimal).toBe(20);
    });
  });

  describe("caching functionality", () => {
    it("should cache and retrieve metrics", async () => {
      const storeId = "test-store-id";
      const metricType = "turnover";
      const data = { turnover_rate: 4.5 };

      // Mock cache operations
      setupMockQuery([
        [], // Check existing cache (empty)
        [{ cache_id: "cache-1" }], // Insert cache
        [{ data, created_at: new Date() }], // Get from cache
      ]);

      // Cache the data
      await Analytics.cacheMetric(storeId, metricType, data, 60);

      // Retrieve from cache
      const cached = await Analytics.getFromCache(storeId, metricType);

      expect(cached).toEqual(data);
      expect(mockDb.query).toHaveBeenCalledTimes(3);
    });

    it("should return null for expired cache", async () => {
      const storeId = "test-store-id";
      const metricType = "turnover";

      // Mock expired cache
      const expiredDate = new Date();
      expiredDate.setMinutes(expiredDate.getMinutes() - 120);

      setupMockQuery([
        [
          {
            data: { turnover_rate: 4.5 },
            created_at: expiredDate,
            ttl_minutes: 60,
          },
        ],
      ]);

      const cached = await Analytics.getFromCache(storeId, metricType);

      expect(cached).toBeNull();
    });
  });
});
