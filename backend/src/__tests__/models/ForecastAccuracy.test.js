const ForecastAccuracy = require("../../models/ForecastAccuracy");
const { mockDb, resetMockDb, setupMockQuery } = require("../setup/testDb");

// Mock the database module
jest.mock("../../../config/database", () => ({
  query: (...args) => mockDb.query(...args),
}));

describe("ForecastAccuracy Model - Basic Tests", () => {
  beforeEach(() => {
    resetMockDb();
  });

  describe("recordAccuracy", () => {
    it("should record basic forecast accuracy", async () => {
      setupMockQuery([
        [{ accuracy_id: "acc-1" }], // insert result
      ]);

      const result = await ForecastAccuracy.recordAccuracy({
        productId: "prod-1",
        forecastValue: 100,
        actualValue: 95,
        forecastPeriod: "weekly"
      });

      expect(mockDb.query).toHaveBeenCalled();
    });
  });

  describe("getAccuracyMetrics", () => {
    it("should get basic accuracy metrics", async () => {
      setupMockQuery([
        [{ avg_mape: 15.2, avg_rmse: 8.5, model_name: "prophet" }], // metrics data
      ]);

      const result = await ForecastAccuracy.getAccuracyMetrics("prod-1", "weekly");

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getModelComparison", () => {
    it("should compare models", async () => {
      setupMockQuery([
        [{ model_name: "prophet", avg_accuracy: 85.5 }], // comparison data
      ]);

      const result = await ForecastAccuracy.getModelComparison("store-1");

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});