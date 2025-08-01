// Global Jest setup for all tests

// Mock bcrypt to avoid native module issues on Windows
jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("hashedPassword"),
  compare: jest.fn().mockResolvedValue(true),
  genSalt: jest.fn().mockResolvedValue("salt"),
}));

// Mock crypto for consistent testing
jest.mock("crypto", () => ({
  randomBytes: jest.fn().mockReturnValue(Buffer.from("randomBytes")),
  createCipher: jest.fn(),
  createDecipher: jest.fn(),
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue("hashedValue"),
  }),
}));

// Global mocks for common modules that might be imported

// Mock environment variables for testing
process.env.JWT_SECRET = "test-jwt-secret";
process.env.NODE_ENV = "test";
