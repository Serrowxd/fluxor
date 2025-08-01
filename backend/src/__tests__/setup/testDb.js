/**
 * Test Database Utilities
 * This file provides mock database utilities for testing
 * It's not a test file itself, just utilities for tests
 */

const { Pool } = require("pg");
require("dotenv").config();

// Use a test database URL or default test configuration
const testDbUrl =
  process.env.TEST_DATABASE_URL ||
  `postgresql://${process.env.DB_USER || "postgres"}:${
    process.env.DB_PASSWORD || "password"
  }@${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || "5432"}/${
    process.env.DB_NAME || "inventory_test"
  }`;

const testPool = new Pool({
  connectionString: testDbUrl,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Mock database for unit tests
const mockDb = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
};

// Helper to reset mock database
const resetMockDb = () => {
  mockDb.query.mockReset();
  mockDb.connect.mockReset();
  mockDb.end.mockReset();
};

// Helper to setup mock query responses
const setupMockQuery = (responses) => {
  responses.forEach((response, index) => {
    mockDb.query.mockResolvedValueOnce({ rows: response });
  });
};

module.exports = {
  testPool,
  mockDb,
  resetMockDb,
  setupMockQuery,
};
