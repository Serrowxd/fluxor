const migration = require("../../migrations/004_chatbot_system");
const db = require("../../../config/database");

// Mock database
jest.mock("../../../config/database");

describe("Chat Database Migration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({ rows: [] });
  });

  describe("up migration", () => {
    it("should create all required tables", async () => {
      await migration.up();

      // Check that all tables were created
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS chat_conversations"));
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS chat_messages"));
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS chat_analytics"));
    });

    it("should create proper indexes", async () => {
      await migration.up();

      // Check that all indexes were created
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_active"));
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_chat_conversations_store"));
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_time"));
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_chat_messages_type"));
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_chat_analytics_category_time"));
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_chat_analytics_user_time"));
    });

    it("should create trigger for updating conversation timestamp", async () => {
      await migration.up();

      // Check that trigger and function were created
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("CREATE OR REPLACE FUNCTION update_chat_conversation_timestamp()"));
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("CREATE TRIGGER update_conversation_timestamp"));
    });

    it("should set up proper foreign key constraints", async () => {
      await migration.up();

      // Check foreign key constraints in table definitions
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE"));
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("conversation_id UUID NOT NULL REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE"));
    });

    it("should set up check constraints", async () => {
      await migration.up();

      // Check constraints for message_type and user_satisfaction
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("message_type VARCHAR(20) NOT NULL CHECK (message_type IN ('user', 'assistant', 'system'))"));
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("user_satisfaction INTEGER CHECK (user_satisfaction >= 1 AND user_satisfaction <= 5)"));
    });
  });

  describe("down migration", () => {
    it("should handle rollback correctly", async () => {
      await migration.down();

      // Check that trigger and function are dropped first
      expect(db.query).toHaveBeenCalledWith("DROP TRIGGER IF EXISTS update_conversation_timestamp ON chat_messages");
      expect(db.query).toHaveBeenCalledWith("DROP FUNCTION IF EXISTS update_chat_conversation_timestamp()");

      // Check that indexes are dropped
      expect(db.query).toHaveBeenCalledWith("DROP INDEX IF EXISTS idx_chat_analytics_user_time");
      expect(db.query).toHaveBeenCalledWith("DROP INDEX IF EXISTS idx_chat_analytics_category_time");
      expect(db.query).toHaveBeenCalledWith("DROP INDEX IF EXISTS idx_chat_messages_type");
      expect(db.query).toHaveBeenCalledWith("DROP INDEX IF EXISTS idx_chat_messages_conversation_time");
      expect(db.query).toHaveBeenCalledWith("DROP INDEX IF EXISTS idx_chat_conversations_store");
      expect(db.query).toHaveBeenCalledWith("DROP INDEX IF EXISTS idx_chat_conversations_user_active");

      // Check that tables are dropped in correct order
      expect(db.query).toHaveBeenCalledWith("DROP TABLE IF EXISTS chat_analytics CASCADE");
      expect(db.query).toHaveBeenCalledWith("DROP TABLE IF EXISTS chat_messages CASCADE");
      expect(db.query).toHaveBeenCalledWith("DROP TABLE IF EXISTS chat_conversations CASCADE");
    });

    it("should drop elements in correct order to avoid dependency issues", async () => {
      await migration.down();

      const callOrder = db.query.mock.calls.map(call => call[0]);
      
      // Trigger should be dropped before function
      const triggerIndex = callOrder.findIndex(call => call.includes("DROP TRIGGER"));
      const functionIndex = callOrder.findIndex(call => call.includes("DROP FUNCTION"));
      expect(triggerIndex).toBeLessThan(functionIndex);

      // Tables should be dropped after indexes
      const firstTableDrop = callOrder.findIndex(call => call.includes("DROP TABLE"));
      const lastIndexDrop = callOrder.findIndex(call => call.includes("DROP INDEX"));
      expect(lastIndexDrop).toBeLessThan(firstTableDrop);
    });
  });

  describe("error handling", () => {
    it("should handle database errors gracefully", async () => {
      db.query.mockRejectedValueOnce(new Error("Database connection error"));

      await expect(migration.up()).rejects.toThrow("Database connection error");
    });
  });
});