// Mock bcrypt to avoid native module issues on Windows
jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("hashedPassword"),
  compare: jest.fn().mockResolvedValue(true),
  genSalt: jest.fn().mockResolvedValue("salt"),
}));

// Mock database to avoid real DB connection
jest.mock("../../../config/database", () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));

const request = require("supertest");
const app = require("../../index"); // Main Express app

describe("Dashboard Integration Tests", () => {
  let authToken;
  const testStoreId = "test-store-123";

  beforeAll(async () => {
    // Mock authentication for tests
    authToken = "mock-jwt-token";
  });

  describe("Ticket #1: Enhanced Dashboard Analytics", () => {
    it("should retrieve comprehensive dashboard metrics", async () => {
      const response = await request(app)
        .get(`/api/analytics/dashboard/${testStoreId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      // Verify all key metrics are present
      expect(response.body).toHaveProperty("inventoryTurnover");
      expect(response.body).toHaveProperty("stockoutRate");
      expect(response.body).toHaveProperty("carryingCostPercentage");
      expect(response.body).toHaveProperty("avgGrossMargin");
      expect(response.body).toHaveProperty("stockStatus");

      // Verify stock status breakdown
      expect(response.body.stockStatus).toHaveProperty("critical");
      expect(response.body.stockStatus).toHaveProperty("low");
      expect(response.body.stockStatus).toHaveProperty("optimal");
      expect(response.body.stockStatus).toHaveProperty("overstock");
    });

    it("should calculate inventory turnover with benchmarks", async () => {
      const response = await request(app)
        .get(`/api/analytics/turnover/${testStoreId}`)
        .query({ period: 30 })
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      if (response.body.length > 0) {
        const item = response.body[0];
        expect(item).toHaveProperty("turnover_rate");
        expect(item).toHaveProperty("performance_category");
        expect(item).toHaveProperty("industry_benchmark");
      }
    });
  });

  describe("Ticket #2: Forecast Accuracy and Dead Stock", () => {
    it("should track forecast accuracy metrics", async () => {
      const response = await request(app)
        .get("/api/forecast/accuracy")
        .query({ storeId: testStoreId, period: 30 })
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("metrics");
      expect(response.body).toHaveProperty("modelPerformance");
    });

    it("should identify dead stock with liquidation recommendations", async () => {
      const response = await request(app)
        .get("/api/forecast/dead-stock")
        .query({ storeId: testStoreId })
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("slowMoving");
      expect(response.body).toHaveProperty("deadStock");
      expect(response.body).toHaveProperty("obsolete");
      expect(response.body).toHaveProperty("totalValue");
      expect(response.body).toHaveProperty("recommendations");
    });
  });

  describe("Ticket #3: Multi-Channel Synchronization", () => {
    it("should list active channels", async () => {
      const response = await request(app)
        .get("/api/multi-channel/channels")
        .query({ storeId: testStoreId })
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it("should handle sync status requests", async () => {
      const response = await request(app)
        .get("/api/multi-channel/sync/status")
        .query({ storeId: testStoreId })
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      if (response.body.length > 0) {
        const status = response.body[0];
        expect(status).toHaveProperty("channel_id");
        expect(status).toHaveProperty("sync_status");
        expect(status).toHaveProperty("last_sync_at");
      }
    });

    it("should retrieve pending conflicts", async () => {
      const response = await request(app)
        .get("/api/multi-channel/conflicts")
        .query({ storeId: testStoreId, status: "pending" })
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe("Ticket #4: Supplier Integration and Purchase Orders", () => {
    it("should list suppliers", async () => {
      const response = await request(app)
        .get("/api/suppliers")
        .query({ storeId: testStoreId })
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it("should retrieve purchase order analytics", async () => {
      const response = await request(app)
        .get("/api/purchase-orders/analytics")
        .query({ storeId: testStoreId, period: 30 })
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it("should calculate reorder points", async () => {
      const response = await request(app)
        .post("/api/purchase-orders/reorder/calculate")
        .send({
          storeId: testStoreId,
          productId: "test-product-123",
          serviceLevel: 0.95,
        })
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("reorderPoint");
      expect(response.body).toHaveProperty("safetyStock");
      expect(response.body).toHaveProperty("confidence");
    });
  });

  describe("Cross-Feature Integration", () => {
    it("should provide unified dashboard data combining all features", async () => {
      // This tests that all features work together to provide comprehensive data
      const dashboardResponse = await request(app)
        .get(`/api/analytics/dashboard/${testStoreId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      // Verify data from multiple tickets is integrated
      expect(dashboardResponse.body).toHaveProperty("inventoryTurnover"); // Ticket 1
      expect(dashboardResponse.body).toHaveProperty("forecastAccuracy"); // Ticket 2
      expect(dashboardResponse.body).toHaveProperty("channelSyncStatus"); // Ticket 3
      expect(dashboardResponse.body).toHaveProperty("pendingPurchaseOrders"); // Ticket 4
    });
  });
});
