const ConflictResolutionEngine = require("../../services/ConflictResolutionEngine");
const { mockDb, resetMockDb, setupMockQuery } = require("../setup/testDb");

// Mock the database module
jest.mock("../../../config/database", () => ({
  query: (...args) => mockDb.query(...args),
}));

describe("ConflictResolutionEngine - Basic Tests", () => {
  let conflictResolutionEngine;

  beforeEach(() => {
    resetMockDb();
    conflictResolutionEngine = new ConflictResolutionEngine();
  });

  describe("instantiation", () => {
    it("should create service instance", () => {
      expect(conflictResolutionEngine).toBeDefined();
      expect(typeof conflictResolutionEngine.detectConflicts).toBe("function");
      expect(typeof conflictResolutionEngine.resolveConflicts).toBe("function");
    });
  });

  describe("detectConflicts", () => {
    it("should detect conflicts without errors", async () => {
      setupMockQuery([
        [], // empty channels
        [], // empty local inventory
        [], // empty mismatches
      ]);

      const result = await conflictResolutionEngine.detectConflicts("prod-1");

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});