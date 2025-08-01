// Global Jest setup for all tests

// Mock bcrypt to avoid native module issues on Windows
jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("hashedPassword"),
  compare: jest.fn().mockResolvedValue(true),
  genSalt: jest.fn().mockResolvedValue("salt"),
}));

// Mock crypto for consistent testing
jest.mock("crypto", () => ({
  randomBytes: jest.fn().mockReturnValue(Buffer.from("0123456789abcdef0123456789abcdef", "hex")),
  randomFillSync: jest.fn(() => Buffer.alloc(16)),
  createCipher: jest.fn(),
  createDecipher: jest.fn(),
  createCipheriv: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnValue("encrypted"),
    final: jest.fn().mockReturnValue("final"),
  }),
  createDecipheriv: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnValue("decrypted"),
    final: jest.fn().mockReturnValue("final"),
  }),
  scryptSync: jest.fn().mockReturnValue(Buffer.from("0123456789abcdef0123456789abcdef", "hex")),
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue("hashedValue"),
  }),
}));

// Mock UUID to prevent crypto issues
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-' + Math.random().toString(36).substr(2, 9))
}));

// Mock Redis globally
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(),
    disconnect: jest.fn().mockResolvedValue(),
    on: jest.fn(),
    off: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  }))
}));

// Mock Bull queues globally
jest.mock('bull', () => {
  return jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-123' }),
    process: jest.fn(),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(),
  }));
});

// Global mocks for common modules that might be imported

// Mock environment variables for testing
process.env.JWT_SECRET = "test-jwt-secret-with-sufficient-length-for-security";
process.env.ENCRYPTION_KEY = "test-encryption-key-with-sufficient-length-for-security";
process.env.NODE_ENV = "test";

// Set test timeout
jest.setTimeout(10000);

// Global cleanup
afterEach(() => {
  jest.clearAllMocks();
});

// Prevent hanging tests
afterAll(async () => {
  // Close any open handles
  await new Promise(resolve => setTimeout(resolve, 100));
});
