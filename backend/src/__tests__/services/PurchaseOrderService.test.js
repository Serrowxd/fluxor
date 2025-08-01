const PurchaseOrderService = require("../../services/PurchaseOrderService");
const { mockDb, resetMockDb, setupMockQuery } = require("../setup/testDb");

// Mock the database module
jest.mock("../../../config/database", () => ({
  query: (...args) => mockDb.query(...args),
  getClient: () => mockDb.getClient(),
}));

describe("PurchaseOrderService - Basic Tests", () => {
  let purchaseOrderService;

  beforeEach(() => {
    resetMockDb();
    purchaseOrderService = new PurchaseOrderService();
  });

  describe("instantiation", () => {
    it("should create service instance", () => {
      expect(purchaseOrderService).toBeDefined();
      expect(typeof purchaseOrderService.generatePONumber).toBe("function");
      expect(typeof purchaseOrderService.createPurchaseOrder).toBe("function");
    });
  });

  describe("generatePONumber", () => {
    it("should generate a PO number", async () => {
      setupMockQuery([
        [{ next_number: 1 }], // count query
      ]);

      const result = await purchaseOrderService.generatePONumber("store-1");

      expect(result).toMatch(/^PO\d{8}$/); // Format: PO + YYMMNNNN
    });
  });
});