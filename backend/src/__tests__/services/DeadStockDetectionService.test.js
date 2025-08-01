const DeadStockDetectionService = require("../../services/DeadStockDetectionService");
const { mockDb, resetMockDb, setupMockQuery } = require("../setup/testDb");

// Mock the database module
jest.mock("../../../config/database", () => ({
  query: (...args) => mockDb.query(...args),
}));

describe("DeadStockDetectionService - Ticket #2", () => {
  beforeEach(() => {
    resetMockDb();
  });

  describe("runDeadStockDetectionForStore", () => {
    it("should detect dead stock based on configured timeframes", async () => {
      const storeId = "test-store-id";
      const config = {
        slowMovingDays: 30,
        deadStockDays: 60,
        obsoleteDays: 90,
        minStockValue: 10,
      };

      // Mock products data
      const productsData = [
        {
          product_id: "prod-1",
          product_name: "Slow Moving Product",
          sku: "SKU001",
          current_stock: 50,
          unit_cost: 10,
          last_sale_date: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days ago
        },
        {
          product_id: "prod-2",
          product_name: "Dead Stock Product",
          sku: "SKU002",
          current_stock: 100,
          unit_cost: 5,
          last_sale_date: new Date(Date.now() - 65 * 24 * 60 * 60 * 1000), // 65 days ago
        },
        {
          product_id: "prod-3",
          product_name: "Obsolete Product",
          sku: "SKU003",
          current_stock: 20,
          unit_cost: 25,
          last_sale_date: new Date(Date.now() - 95 * 24 * 60 * 60 * 1000), // 95 days ago
        },
      ];

      // Mock sales history for velocity calculation
      const salesHistory = [
        { product_id: "prod-1", total_quantity: 10, sales_days: 30 },
        { product_id: "prod-2", total_quantity: 2, sales_days: 60 },
        { product_id: "prod-3", total_quantity: 0, sales_days: 90 },
      ];

      setupMockQuery([
        productsData, // getProductsWithInventory
        salesHistory, // getSalesHistory for each product
        [], // saveAnalysis results
      ]);

      const result =
        await DeadStockDetectionService.runDeadStockDetectionForStore(
          storeId,
          config
        );

      expect(result.success).toBe(true);
      expect(result.analysis).toBeDefined();
      expect(result.analysis.slowMoving).toHaveLength(1);
      expect(result.analysis.deadStock).toHaveLength(1);
      expect(result.analysis.obsolete).toHaveLength(1);
      expect(result.summary.totalDeadStockValue).toBeGreaterThan(0);
    });

    it("should calculate velocity scores correctly", async () => {
      const productId = "test-product";
      const windowDays = 30;

      const salesData = [
        {
          total_quantity: 150,
          sales_days: 25, // Sold on 25 out of 30 days
        },
      ];

      setupMockQuery([salesData]);

      const velocity = await DeadStockDetectionService.calculateVelocity(
        productId,
        windowDays
      );

      // Expected: (150/30) * (25/30) * 20 = 5 * 0.833 * 20 = 83.3
      expect(velocity).toBeCloseTo(83.3, 1);
    });

    it("should handle products with no sales history", async () => {
      const productId = "test-product";
      const windowDays = 30;

      setupMockQuery([[]]); // No sales data

      const velocity = await DeadStockDetectionService.calculateVelocity(
        productId,
        windowDays
      );

      expect(velocity).toBe(0);
    });
  });

  describe("analyzeDeadStockTrends", () => {
    it("should analyze trends over time", async () => {
      const storeId = "test-store-id";
      const period = 90;

      const trendData = [
        {
          analysis_week: "2024-01-01",
          slow_moving_count: 5,
          dead_stock_count: 3,
          obsolete_count: 1,
          total_value: 2500,
        },
        {
          analysis_week: "2024-01-08",
          slow_moving_count: 6,
          dead_stock_count: 4,
          obsolete_count: 2,
          total_value: 3200,
        },
      ];

      setupMockQuery([trendData]);

      const result = await DeadStockDetectionService.analyzeDeadStockTrends(
        storeId,
        period
      );

      expect(result).toHaveLength(2);
      expect(result[1].dead_stock_count).toBe(4);
      expect(result[1].total_value).toBe(3200);
    });
  });

  describe("getLiquidationCandidates", () => {
    it("should identify immediate liquidation candidates", async () => {
      const storeId = "test-store-id";
      const urgencyThreshold = 8;

      const candidatesData = [
        {
          product_id: "prod-1",
          product_name: "Urgent Liquidation Product",
          current_stock_value: 1000,
          liquidation_priority: 9,
          days_without_sale: 120,
          suggested_discount_percentage: 60,
          estimated_recovery_value: 400,
        },
      ];

      setupMockQuery([candidatesData]);

      const result = await DeadStockDetectionService.getLiquidationCandidates(
        storeId,
        urgencyThreshold
      );

      expect(result).toHaveLength(1);
      expect(result[0].liquidation_priority).toBe(9);
      expect(result[0].suggested_discount_percentage).toBe(60);
    });
  });

  describe("calculateLiquidationImpact", () => {
    it("should calculate financial impact of liquidation", async () => {
      const storeId = "test-store-id";

      const impactData = [
        {
          total_current_value: 10000,
          total_recovery_value: 4000,
          potential_recovery_rate: 0.4,
          products_affected: 25,
          immediate_cash_recovery: 2000,
          space_freed_percentage: 15,
        },
      ];

      setupMockQuery([impactData]);

      const result = await DeadStockDetectionService.calculateLiquidationImpact(
        storeId
      );

      expect(result.totalCurrentValue).toBe(10000);
      expect(result.totalRecoveryValue).toBe(4000);
      expect(result.potentialRecoveryRate).toBe(0.4);
      expect(result.productsAffected).toBe(25);
    });
  });
});
