const db = require('../../config/database');
const { ApiError } = require('../middleware/errorHandler');

class ChatHistoryService {
  /**
   * Save a message to the conversation history
   */
  async saveMessage(request) {
    const { userId, storeId, conversationId, userMessage, assistantResponse, intentCategory, metadata } = request;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Create or get conversation
      let conversation;
      if (conversationId) {
        const existingConv = await client.query(
          'SELECT * FROM chat_conversations WHERE conversation_id = $1 AND user_id = $2',
          [conversationId, userId]
        );
        conversation = existingConv.rows[0];
      }

      if (!conversation) {
        // Create new conversation
        const title = this.generateConversationTitle(userMessage);
        const newConv = await client.query(
          `INSERT INTO chat_conversations (user_id, store_id, conversation_title, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           RETURNING *`,
          [userId, storeId, title]
        );
        conversation = newConv.rows[0];
      } else {
        // Update conversation timestamp
        await client.query(
          'UPDATE chat_conversations SET updated_at = NOW() WHERE conversation_id = $1',
          [conversationId]
        );
      }

      // Save user message
      await client.query(
        `INSERT INTO chat_messages (conversation_id, message_type, content, created_at)
         VALUES ($1, 'user', $2, NOW())`,
        [conversation.conversation_id, userMessage]
      );

      // Save assistant response
      await client.query(
        `INSERT INTO chat_messages (conversation_id, message_type, content, metadata, tokens_used, response_time_ms, created_at)
         VALUES ($1, 'assistant', $2, $3, $4, $5, NOW())`,
        [
          conversation.conversation_id,
          assistantResponse,
          JSON.stringify({ intentCategory, ...metadata }),
          metadata.tokensUsed,
          metadata.responseTimeMs
        ]
      );

      await client.query('COMMIT');
      return conversation;

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error saving message:', error);
      throw new ApiError(500, 'Failed to save message');
    } finally {
      client.release();
    }
  }

  /**
   * Get conversation history
   */
  async getConversationHistory(conversationId, userId = null) {
    try {
      // Verify user owns this conversation if userId provided
      if (userId) {
        const convResult = await db.query(
          'SELECT * FROM chat_conversations WHERE conversation_id = $1 AND user_id = $2',
          [conversationId, userId]
        );
        
        if (convResult.rows.length === 0) {
          throw new ApiError(404, 'Conversation not found or access denied');
        }
      }

      const messages = await db.query(
        `SELECT message_id, message_type, content, metadata, tokens_used, 
                response_time_ms, created_at
         FROM chat_messages 
         WHERE conversation_id = $1 
         ORDER BY created_at ASC`,
        [conversationId]
      );

      return messages.rows.map(msg => ({
        ...msg,
        metadata: msg.metadata || {}
      }));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Error fetching conversation history:', error);
      throw new ApiError(500, 'Failed to fetch conversation history');
    }
  }

  /**
   * Get user's conversations
   */
  async getUserConversations(userId) {
    try {
      const conversations = await db.query(
        `SELECT c.conversation_id, c.conversation_title as title, 
                c.created_at, c.updated_at,
                COUNT(m.message_id) as message_count,
                MAX(m.content) FILTER (WHERE m.message_type = 'user') as last_message
         FROM chat_conversations c
         LEFT JOIN chat_messages m ON c.conversation_id = m.conversation_id
         WHERE c.user_id = $1 AND c.is_active = true
         GROUP BY c.conversation_id
         ORDER BY c.updated_at DESC`,
        [userId]
      );

      return conversations.rows.map(conv => ({
        conversationId: conv.conversation_id,
        title: conv.title,
        lastMessage: conv.last_message || '',
        messageCount: parseInt(conv.message_count || '0'),
        createdAt: conv.created_at,
        updatedAt: conv.updated_at
      }));
    } catch (error) {
      console.error('Error fetching user conversations:', error);
      throw new ApiError(500, 'Failed to fetch conversations');
    }
  }

  /**
   * Delete (soft delete) a conversation
   */
  async deleteConversation(conversationId, userId) {
    try {
      // Verify ownership
      const result = await db.query(
        `UPDATE chat_conversations 
         SET is_active = false, updated_at = NOW()
         WHERE conversation_id = $1 AND user_id = $2
         RETURNING conversation_id`,
        [conversationId, userId]
      );

      if (result.rows.length === 0) {
        throw new ApiError(404, 'Conversation not found or access denied');
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Error deleting conversation:', error);
      throw new ApiError(500, 'Failed to delete conversation');
    }
  }

  /**
   * Get chat analytics
   */
  async getChatAnalytics(userId, timeframe = 'week') {
    try {
      const intervals = {
        day: '1 day',
        week: '7 days',
        month: '30 days'
      };

      const interval = intervals[timeframe] || intervals.week;

      const analytics = await db.query(
        `SELECT 
          DATE(m.created_at) as date,
          COUNT(*) as message_count,
          AVG(m.response_time_ms) FILTER (WHERE m.message_type = 'assistant') as avg_response_time,
          SUM(m.tokens_used) FILTER (WHERE m.message_type = 'assistant') as total_tokens,
          COUNT(DISTINCT c.conversation_id) as conversation_count
         FROM chat_messages m
         JOIN chat_conversations c ON m.conversation_id = c.conversation_id
         WHERE c.user_id = $1 
           AND m.created_at >= NOW() - INTERVAL '${interval}'
         GROUP BY DATE(m.created_at)
         ORDER BY date DESC`,
        [userId]
      );

      // Get category breakdown
      const categoryBreakdown = await db.query(
        `SELECT 
          (m.metadata->>'intentCategory')::text as category,
          COUNT(*) as count
         FROM chat_messages m
         JOIN chat_conversations c ON m.conversation_id = c.conversation_id
         WHERE c.user_id = $1 
           AND m.message_type = 'assistant'
           AND m.created_at >= NOW() - INTERVAL '${interval}'
           AND m.metadata->>'intentCategory' IS NOT NULL
         GROUP BY category
         ORDER BY count DESC`,
        [userId]
      );

      return {
        dailyStats: analytics.rows.map(row => ({
          date: row.date,
          messageCount: parseInt(row.message_count),
          avgResponseTime: parseFloat(row.avg_response_time) || 0,
          totalTokens: parseInt(row.total_tokens) || 0,
          conversationCount: parseInt(row.conversation_count)
        })),
        categoryBreakdown: categoryBreakdown.rows.map(row => ({
          category: row.category,
          count: parseInt(row.count)
        }))
      };
    } catch (error) {
      console.error('Error fetching chat analytics:', error);
      throw new ApiError(500, 'Failed to fetch analytics');
    }
  }

  /**
   * Log analytics data
   */
  async logAnalytics(data) {
    try {
      await db.query(
        `INSERT INTO chat_analytics (user_id, question_category, user_satisfaction, 
                                    was_helpful, follow_up_action, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          data.user_id,
          data.question_category,
          data.user_satisfaction,
          data.was_helpful,
          data.follow_up_action,
          JSON.stringify(data.metadata || {})
        ]
      );
    } catch (error) {
      console.error('Error logging analytics:', error);
      // Don't throw - this is fire and forget
    }
  }

  /**
   * Generate a conversation title from the first message
   */
  generateConversationTitle(firstMessage) {
    const words = firstMessage.trim().split(' ').slice(0, 6);
    let title = words.join(' ');
    
    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    }
    
    return title || 'New Conversation';
  }
}

module.exports = ChatHistoryService;