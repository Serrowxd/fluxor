const ReorderPointEngine = require("../../services/ReorderPointEngine");
const { mockDb, resetMockDb, setupMockQuery } = require("../setup/testDb");

// Mock the database module
jest.mock("../../../config/database", () => ({
  query: (...args) => mockDb.query(...args),
}));

describe("ReorderPointEngine - Basic Tests", () => {
  beforeEach(() => {
    resetMockDb();
  });

  describe("calculateReorderPoint", () => {
    it("should calculate basic reorder point", async () => {
      const reorderPointEngine = new ReorderPointEngine();
      const productId = "prod-1";
      
      // Setup minimal mock data for all required queries
      setupMockQuery([
        [{ supplier_id: "sup-1", lead_time_days: 7, cost_per_unit: 10 }], // getProductSupplierInfo
        [{ average_daily_demand: 5, demand_stddev: 1 }], // calculateDemandStatistics
        [{ delivery_count: 5, average_lead_time: 7, lead_time_stddev: 1 }], // calculateLeadTimeStatistics
        [{ seasonal_factor: 1.0 }], // calculateSeasonalFactor
        [{ cost_per_unit: 10, minimum_order_quantity: 10 }], // calculateEOQ cost info
      ]);

      const result = await reorderPointEngine.calculateReorderPoint(productId);

      expect(result).toBeDefined();
      expect(result.product_id).toBe(productId);
      expect(result.recommended_reorder_point).toBeGreaterThan(0);
    });
  });

  describe("calculateEOQ", () => {
    it("should calculate basic EOQ", async () => {
      const reorderPointEngine = new ReorderPointEngine();
      const productId = "prod-1";
      const supplierId = "sup-1";
      const demandStats = { average_daily_demand: 5 };

      setupMockQuery([
        [{ cost_per_unit: 10, minimum_order_quantity: 10 }], // cost info
      ]);

      const result = await reorderPointEngine.calculateEOQ(productId, supplierId, demandStats);

      expect(result).toBeDefined();
      expect(result.economic_order_quantity).toBeGreaterThan(0);
    });
  });

  describe("analyzeSeasonality", () => {
    it("should analyze seasonality", async () => {
      const reorderPointEngine = new ReorderPointEngine();
      const productId = "prod-1";

      setupMockQuery([
        [{ month: 1, seasonal_index: 1.2 }, { month: 2, seasonal_index: 0.8 }], // seasonal data
      ]);

      const result = await reorderPointEngine.analyzeSeasonality(productId);

      expect(result).toBeDefined();
      expect(typeof result.hasSeasonality).toBe("boolean");
    });
  });
});