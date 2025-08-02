const db = require("../../config/database");

module.exports = {
  up: async () => {
    console.log("Running migration 005_chat_analytics_metadata...");

    // Add metadata column to chat_analytics table
    await db.query(`
      ALTER TABLE chat_analytics 
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'
    `);

    console.log("Migration 005_chat_analytics_metadata completed");
  },

  down: async () => {
    console.log("Rolling back migration 005_chat_analytics_metadata...");

    await db.query(`
      ALTER TABLE chat_analytics 
      DROP COLUMN IF EXISTS metadata
    `);

    console.log("Rollback of 005_chat_analytics_metadata completed");
  },
};