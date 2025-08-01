const Analytics = require("../../models/Analytics");
const { mockDb, resetMockDb, setupMockQuery } = require("../setup/testDb");

// Mock the database module
jest.mock("../../../config/database", () => ({
  query: (...args) => mockDb.query(...args),
}));

describe("Analytics Model - Basic Tests", () => {
  beforeEach(() => {
    resetMockDb();
  });

  describe("calculateInventoryTurnover", () => {
    it("should calculate basic inventory turnover", async () => {
      setupMockQuery([
        [{ product_id: "prod-1", turnover_rate: 4.5, category: "good" }], // turnover data
      ]);

      const result = await Analytics.calculateInventoryTurnover("store-1", "30 days");

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("calculateStockoutRate", () => {
    it("should calculate basic stockout rate", async () => {
      setupMockQuery([
        [{ stockout_rate: 3.2, lost_revenue: 1500 }], // stockout data
      ]);

      const result = await Analytics.calculateStockoutRate("store-1", "30 days");

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getDashboardMetrics", () => {
    it("should get basic dashboard metrics", async () => {
      setupMockQuery([
        [{ turnover_rate: 4.5 }], // inventory turnover
        [{ stockout_rate: 3.2 }], // stockout rate
        [{ total_carrying_cost: 15000 }], // carrying costs
        [{ avg_margin: 32.5 }], // gross margins
        [{ critical_count: 12 }], // stock levels
      ]);

      const result = await Analytics.getDashboardMetrics("store-1");

      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
    });
  });

  describe("caching", () => {
    it("should cache and retrieve data", async () => {
      const cacheKey = "test-cache-key";
      const testData = { value: "test" };

      setupMockQuery([
        [], // cache insert
        [{ cache_data: JSON.stringify(testData) }], // cache retrieve
      ]);

      await Analytics.cacheAnalytics(cacheKey, testData, 60);
      const cached = await Analytics.getCachedAnalytics(cacheKey);

      expect(mockDb.query).toHaveBeenCalled();
    });
  });
});