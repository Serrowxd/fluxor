const DeadStockDetectionService = require("../../services/DeadStockDetectionService");
const { mockDb, resetMockDb, setupMockQuery } = require("../setup/testDb");

// Mock the database module
jest.mock("../../../config/database", () => ({
  query: (...args) => mockDb.query(...args),
}));

// Mock DeadStockAnalysis model to prevent database errors
jest.mock("../../models/DeadStockAnalysis", () => ({
  create: jest.fn().mockResolvedValue({ analysis_id: "test-id" })
}));

describe("DeadStockDetectionService - Basic Tests", () => {
  beforeEach(() => {
    resetMockDb();
  });

  describe("calculateVelocity", () => {
    it("should calculate basic velocity", async () => {
      setupMockQuery([
        [{ total_quantity: 100, active_days: 10, avg_daily_sales: 10 }], // sales data
      ]);

      const result = await DeadStockDetectionService.calculateVelocity("prod-1", 30);

      expect(result).toBeDefined();
      expect(result.velocity).toBeGreaterThanOrEqual(0);
      expect(result.totalQuantity).toBe(100);
    });
  });

  describe("runDeadStockDetectionForStore", () => {
    it("should run basic dead stock detection", async () => {
      // Mock getProductsWithHistoricalData
      jest.spyOn(DeadStockDetectionService, 'getProductsWithHistoricalData')
        .mockResolvedValue([
          { product_id: "prod-1", current_stock: 10, unit_cost: 5 }
        ]);

      // Mock analyzeProductDeadStockRisk
      jest.spyOn(DeadStockDetectionService, 'analyzeProductDeadStockRisk')
        .mockResolvedValue({
          productId: "prod-1", // Add productId here
          risk_level: "normal",
          risk_score: 0.3,
          velocity_score: 0.8
        });


      const result = await DeadStockDetectionService.runDeadStockDetectionForStore("store-1");

      expect(result).toBeDefined();
    });
  });

  describe("getLiquidationCandidates", () => {
    it("should get liquidation candidates", async () => {
      setupMockQuery([
        [{ product_id: "prod-1", risk_score: 0.9, inventory_value: 500 }], // candidates
      ]);

      const result = await DeadStockDetectionService.getLiquidationCandidates("store-1", 0.8);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});