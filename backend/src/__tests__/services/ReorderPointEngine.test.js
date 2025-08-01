const ReorderPointEngine = require("../../services/ReorderPointEngine");
const { mockDb, resetMockDb, setupMockQuery } = require("../setup/testDb");

// Mock the database module
jest.mock("../../../config/database", () => ({
  query: (...args) => mockDb.query(...args),
}));

describe("ReorderPointEngine - Ticket #4", () => {
  beforeEach(() => {
    resetMockDb();
  });

  describe("calculateReorderPoint", () => {
    it("should calculate reorder point with safety stock", async () => {
      const productId = "prod-1";
      const options = {
        serviceLevel: 0.95, // 95% service level
        includeSeasonality: true,
      };

      // Mock demand statistics
      const demandStats = [
        {
          avg_daily_demand: 10,
          demand_std_dev: 2.5,
          total_days: 90,
          total_quantity: 900,
        },
      ];

      // Mock lead time data
      const leadTimeData = [
        {
          avg_lead_time_days: 7,
          lead_time_std_dev: 1.5,
          total_orders: 10,
        },
      ];

      // Mock seasonal factors
      const seasonalData = [
        {
          current_seasonal_factor: 1.2,
          next_period_factor: 1.3,
        },
      ];

      setupMockQuery([
        demandStats, // Demand statistics
        leadTimeData, // Lead time statistics
        seasonalData, // Seasonal factors
      ]);

      const result = await ReorderPointEngine.calculateReorderPoint(
        productId,
        options
      );

      expect(result.reorderPoint).toBeGreaterThan(0);
      expect(result.safetyStock).toBeGreaterThan(0);
      expect(result.averageDailyDemand).toBe(10);
      expect(result.leadTimeDays).toBe(7);
      expect(result.seasonalAdjustment).toBe(1.2);
      expect(result.confidence).toBeGreaterThan(0.8);

      // Verify reorder point calculation
      // Base reorder point = avg_daily_demand * lead_time * seasonal_factor
      // Plus safety stock based on service level
      const baseReorderPoint = 10 * 7 * 1.2; // 84
      expect(result.reorderPoint).toBeGreaterThan(baseReorderPoint);
    });

    it("should handle products with limited sales history", async () => {
      const productId = "prod-new";
      const options = {
        serviceLevel: 0.95,
      };

      // Mock limited demand data
      const demandStats = [
        {
          avg_daily_demand: 2,
          demand_std_dev: 0.5,
          total_days: 15, // Only 15 days of history
          total_quantity: 30,
        },
      ];

      const leadTimeData = [
        {
          avg_lead_time_days: 7,
          lead_time_std_dev: 0,
          total_orders: 1,
        },
      ];

      setupMockQuery([
        demandStats,
        leadTimeData,
        [], // No seasonal data
      ]);

      const result = await ReorderPointEngine.calculateReorderPoint(
        productId,
        options
      );

      expect(result.confidence).toBeLessThan(0.8); // Lower confidence due to limited data
      expect(result.dataQuality).toBe("limited");
      expect(result.recommendations).toContain("Collect more sales data");
    });
  });

  describe("calculateEOQ", () => {
    it("should calculate Economic Order Quantity", async () => {
      const productId = "prod-1";
      const supplierId = "supplier-1";

      // Mock demand data
      const demandStats = [
        {
          annual_demand: 3600, // 300 units per month
          avg_daily_demand: 10,
        },
      ];

      // Mock cost data
      const costData = [
        {
          unit_cost: 25.0,
          ordering_cost: 50.0, // Fixed cost per order
          carrying_cost_rate: 0.2, // 20% of unit cost
        },
      ];

      // Mock supplier constraints
      const supplierData = [
        {
          minimum_order_quantity: 50,
          bulk_pricing: [
            { min_quantity: 100, unit_cost: 24.0 },
            { min_quantity: 500, unit_cost: 22.5 },
          ],
        },
      ];

      setupMockQuery([demandStats, costData, supplierData]);

      const result = await ReorderPointEngine.calculateEOQ(
        productId,
        supplierId,
        { annual_demand: 3600 }
      );

      // Classic EOQ = sqrt(2 * D * S / H)
      // Where D = annual demand, S = ordering cost, H = holding cost per unit
      const holdingCost = 25.0 * 0.2; // $5 per unit per year
      const classicEOQ = Math.sqrt((2 * 3600 * 50) / holdingCost); // ~268 units

      expect(result.eoq).toBeGreaterThan(0);
      expect(result.eoq).toBeCloseTo(classicEOQ, -1); // Within 10 units
      expect(result.totalAnnualCost).toBeGreaterThan(0);
      expect(result.ordersPerYear).toBeCloseTo(3600 / result.eoq, 1);
      expect(result.bulkPricingAnalysis).toBeDefined();
    });

    it("should respect minimum order quantities", async () => {
      const productId = "prod-1";
      const supplierId = "supplier-1";

      const demandStats = [
        {
          annual_demand: 1200,
          avg_daily_demand: 3.3,
        },
      ];

      const costData = [
        {
          unit_cost: 50.0,
          ordering_cost: 75.0,
          carrying_cost_rate: 0.25,
        },
      ];

      const supplierData = [
        {
          minimum_order_quantity: 200, // High MOQ
          bulk_pricing: [],
        },
      ];

      setupMockQuery([demandStats, costData, supplierData]);

      const result = await ReorderPointEngine.calculateEOQ(
        productId,
        supplierId
      );

      expect(result.eoq).toBeGreaterThanOrEqual(200); // Respects MOQ
      expect(result.constraintApplied).toBe("minimum_order_quantity");
    });
  });

  describe("optimizeReorderPoints", () => {
    it("should optimize reorder points for multiple products", async () => {
      const storeId = "test-store-id";
      const options = {
        serviceLevel: 0.95,
        includeDisabled: false,
      };

      // Mock products needing optimization
      const productsData = [
        {
          product_id: "prod-1",
          product_name: "Product 1",
          current_reorder_point: 50,
          supplier_id: "supplier-1",
        },
        {
          product_id: "prod-2",
          product_name: "Product 2",
          current_reorder_point: 30,
          supplier_id: "supplier-2",
        },
      ];

      // Mock calculations for each product
      const prod1Demand = [
        {
          avg_daily_demand: 10,
          demand_std_dev: 2,
          total_days: 90,
        },
      ];

      const prod1LeadTime = [
        {
          avg_lead_time_days: 5,
          lead_time_std_dev: 1,
        },
      ];

      const prod2Demand = [
        {
          avg_daily_demand: 5,
          demand_std_dev: 1,
          total_days: 90,
        },
      ];

      const prod2LeadTime = [
        {
          avg_lead_time_days: 7,
          lead_time_std_dev: 2,
        },
      ];

      setupMockQuery([
        productsData, // Get products
        prod1Demand, // Product 1 demand
        prod1LeadTime, // Product 1 lead time
        [], // Product 1 seasonal (empty)
        prod2Demand, // Product 2 demand
        prod2LeadTime, // Product 2 lead time
        [], // Product 2 seasonal (empty)
      ]);

      const result = await ReorderPointEngine.optimizeReorderPoints(
        storeId,
        options
      );

      expect(result.productsOptimized).toBe(2);
      expect(result.recommendations).toHaveLength(2);
      expect(result.recommendations[0].productId).toBe("prod-1");
      expect(result.recommendations[0].newReorderPoint).toBeGreaterThan(0);
      expect(result.totalSavingsEstimate).toBeDefined();
    });
  });

  describe("calculateSafetyStock", () => {
    it("should calculate safety stock for given service level", async () => {
      const demandStats = {
        avgDailyDemand: 10,
        demandStdDev: 2.5,
      };
      const leadTimeStats = {
        avgLeadTime: 7,
        leadTimeStdDev: 1.5,
      };
      const serviceLevel = 0.95; // 95% service level, z-score ≈ 1.645

      const safetyStock = await ReorderPointEngine.calculateSafetyStock(
        demandStats,
        leadTimeStats,
        serviceLevel
      );

      // Safety stock formula: z * sqrt(LT * σ_d² + d² * σ_LT²)
      // Where z = service level z-score, LT = lead time, d = demand
      const expectedSafetyStock =
        1.645 *
        Math.sqrt(7 * Math.pow(2.5, 2) + Math.pow(10, 2) * Math.pow(1.5, 2));

      expect(safetyStock).toBeCloseTo(expectedSafetyStock, 1);
    });

    it("should handle zero variability", async () => {
      const demandStats = {
        avgDailyDemand: 10,
        demandStdDev: 0, // No demand variability
      };
      const leadTimeStats = {
        avgLeadTime: 7,
        leadTimeStdDev: 0, // No lead time variability
      };
      const serviceLevel = 0.95;

      const safetyStock = await ReorderPointEngine.calculateSafetyStock(
        demandStats,
        leadTimeStats,
        serviceLevel
      );

      expect(safetyStock).toBe(0); // No safety stock needed when no variability
    });
  });

  describe("analyzeSeasonality", () => {
    it("should detect seasonal patterns", async () => {
      const productId = "prod-1";

      // Mock seasonal sales data
      const seasonalData = [
        { month: 1, avg_daily_sales: 8, year: 2023 },
        { month: 2, avg_daily_sales: 9, year: 2023 },
        { month: 3, avg_daily_sales: 10, year: 2023 },
        { month: 4, avg_daily_sales: 12, year: 2023 },
        { month: 5, avg_daily_sales: 15, year: 2023 },
        { month: 6, avg_daily_sales: 18, year: 2023 },
        { month: 7, avg_daily_sales: 20, year: 2023 },
        { month: 8, avg_daily_sales: 19, year: 2023 },
        { month: 9, avg_daily_sales: 16, year: 2023 },
        { month: 10, avg_daily_sales: 14, year: 2023 },
        { month: 11, avg_daily_sales: 11, year: 2023 },
        { month: 12, avg_daily_sales: 10, year: 2023 },
      ];

      setupMockQuery([seasonalData]);

      const result = await ReorderPointEngine.analyzeSeasonality(productId);

      expect(result.hasSeasonality).toBe(true);
      expect(result.peakMonth).toBe(7); // July
      expect(result.lowMonth).toBe(1); // January
      expect(result.seasonalFactors).toHaveLength(12);
      expect(result.seasonalFactors[6]).toBeGreaterThan(1); // July factor > 1
      expect(result.seasonalFactors[0]).toBeLessThan(1); // January factor < 1
    });
  });
});
