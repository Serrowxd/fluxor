const db = require("../../config/database");

module.exports = {
  up: async () => {
    console.log("Running migration 004_chatbot_system...");

    // Create chat_conversations table
    await db.query(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        store_id UUID REFERENCES stores(store_id) ON DELETE CASCADE,
        conversation_title VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create chat_messages table
    await db.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES chat_conversations(conversation_id) ON DELETE CASCADE,
        message_type VARCHAR(20) NOT NULL CHECK (message_type IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        tokens_used INTEGER DEFAULT 0,
        response_time_ms INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create chat_analytics table
    await db.query(`
      CREATE TABLE IF NOT EXISTS chat_analytics (
        analytics_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        question_category VARCHAR(100),
        user_satisfaction INTEGER CHECK (user_satisfaction >= 1 AND user_satisfaction <= 5),
        was_helpful BOOLEAN,
        follow_up_action VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create indexes for performance optimization
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_active 
      ON chat_conversations(user_id, is_active);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_conversations_store 
      ON chat_conversations(store_id) WHERE store_id IS NOT NULL;
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_time 
      ON chat_messages(conversation_id, created_at);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_type 
      ON chat_messages(message_type);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_analytics_category_time 
      ON chat_analytics(question_category, created_at);
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_analytics_user_time 
      ON chat_analytics(user_id, created_at);
    `);

    // Create trigger to update conversation updated_at timestamp
    await db.query(`
      CREATE OR REPLACE FUNCTION update_chat_conversation_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE chat_conversations 
        SET updated_at = NOW() 
        WHERE conversation_id = NEW.conversation_id;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await db.query(`
      CREATE TRIGGER update_conversation_timestamp
      AFTER INSERT ON chat_messages
      FOR EACH ROW
      EXECUTE FUNCTION update_chat_conversation_timestamp();
    `);

    console.log("Migration 004_chatbot_system completed");
  },

  down: async () => {
    console.log("Rolling back migration 004_chatbot_system...");
    
    // Drop trigger and function
    await db.query("DROP TRIGGER IF EXISTS update_conversation_timestamp ON chat_messages");
    await db.query("DROP FUNCTION IF EXISTS update_chat_conversation_timestamp()");
    
    // Drop indexes
    await db.query("DROP INDEX IF EXISTS idx_chat_analytics_user_time");
    await db.query("DROP INDEX IF EXISTS idx_chat_analytics_category_time");
    await db.query("DROP INDEX IF EXISTS idx_chat_messages_type");
    await db.query("DROP INDEX IF EXISTS idx_chat_messages_conversation_time");
    await db.query("DROP INDEX IF EXISTS idx_chat_conversations_store");
    await db.query("DROP INDEX IF EXISTS idx_chat_conversations_user_active");
    
    // Drop tables
    await db.query("DROP TABLE IF EXISTS chat_analytics CASCADE");
    await db.query("DROP TABLE IF EXISTS chat_messages CASCADE");
    await db.query("DROP TABLE IF EXISTS chat_conversations CASCADE");
    
    console.log("Rollback 004_chatbot_system completed");
  }
};