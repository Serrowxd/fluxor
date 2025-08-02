const ChatContextBuilder = require('../services/chatContextBuilder');
const PromptEngineeringService = require('../services/promptEngineering');
const { OpenAIService } = require('../services/openaiService');
const ChatHistoryService = require('../services/chatHistoryService');
const { ApiError } = require('../middleware/errorHandler');

class ChatController {
  constructor() {
    this.contextBuilder = new ChatContextBuilder();
    this.promptService = new PromptEngineeringService();
    this.openaiService = new OpenAIService(process.env.OPENAI_API_KEY);
    this.chatHistory = new ChatHistoryService();
  }

  async sendMessage(req, res, next) {
    try {
      const { message, conversationId, context } = req.body;
      const { user_id: userId, store_id: storeId } = req.user;

      // Validate input
      if (!message || message.trim().length === 0) {
        throw new ApiError(400, 'Message is required');
      }

      if (message.length > 1000) {
        throw new ApiError(400, 'Message too long. Please keep it under 1000 characters.');
      }

      // Start timing for analytics
      const startTime = Date.now();

      // Build conversation context
      const chatContext = await this.contextBuilder.buildContext(userId, storeId, message);
      
      // Get conversation history
      const history = conversationId 
        ? await this.chatHistory.getConversationHistory(conversationId)
        : [];

      // Classify intent and build prompt
      const intentCategory = this.promptService.classifyIntent(message);
      const { prompt, config } = this.promptService.buildPrompt({
        userMessage: message,
        chatContext,
        conversationHistory: history,
        intentCategory
      });

      // Generate AI response
      const aiResponse = await this.openaiService.generateChatResponse(prompt, config, userId);
      
      // Save conversation
      const conversation = await this.chatHistory.saveMessage({
        userId,
        storeId,
        conversationId,
        userMessage: message,
        assistantResponse: aiResponse.content,
        intentCategory,
        metadata: {
          tokensUsed: aiResponse.tokensUsed,
          responseTimeMs: aiResponse.responseTimeMs,
          confidence: aiResponse.confidence,
          context
        }
      });

      // Calculate total processing time
      const totalTime = Date.now() - startTime;

      // Return response
      res.json({
        conversationId: conversation.conversation_id,
        message: aiResponse.content,
        confidence: aiResponse.confidence,
        metadata: {
          intentCategory,
          processingTimeMs: totalTime,
          tokensUsed: aiResponse.tokensUsed
        }
      });

      // Log analytics (fire and forget)
      this.logChatAnalytics({
        userId,
        storeId,
        intentCategory,
        processingTime: totalTime,
        confidence: aiResponse.confidence,
        messageLength: message.length
      }).catch(err => console.error('Analytics logging failed:', err));

    } catch (error) {
      console.error('Chat controller error:', error);
      
      if (error.message && error.message.includes('Rate limit exceeded')) {
        return next(new ApiError(429, error.message, { retryAfter: 60000 }));
      }

      next(error);
    }
  }

  async streamMessage(req, res, next) {
    // Set up Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const sendEvent = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const { message, conversationId } = req.body;
      const { user_id: userId, store_id: storeId } = req.user;

      // Validate input
      if (!message || message.trim().length === 0) {
        throw new ApiError(400, 'Message is required');
      }

      // Send typing indicator
      sendEvent({ type: 'typing', data: { isTyping: true } });

      // Simulate processing delay for UX
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Process message (same logic as sendMessage but with streaming)
      const chatContext = await this.contextBuilder.buildContext(userId, storeId, message);
      const history = conversationId 
        ? await this.chatHistory.getConversationHistory(conversationId)
        : [];

      const intentCategory = this.promptService.classifyIntent(message);
      const { prompt, config } = this.promptService.buildPrompt({
        userMessage: message,
        chatContext,
        conversationHistory: history,
        intentCategory
      });

      const aiResponse = await this.openaiService.generateChatResponse(prompt, config, userId);

      // Send response
      sendEvent({ 
        type: 'message', 
        data: { 
          content: aiResponse.content,
          confidence: aiResponse.confidence 
        } 
      });

      // Save to history
      const conversation = await this.chatHistory.saveMessage({
        userId,
        storeId,
        conversationId,
        userMessage: message,
        assistantResponse: aiResponse.content,
        intentCategory,
        metadata: {
          tokensUsed: aiResponse.tokensUsed,
          responseTimeMs: aiResponse.responseTimeMs,
          confidence: aiResponse.confidence
        }
      });

      // Send completion with conversation ID
      sendEvent({ 
        type: 'complete', 
        data: { 
          conversationId: conversation.conversation_id 
        } 
      });

    } catch (error) {
      console.error('Stream error:', error);
      sendEvent({ 
        type: 'error', 
        data: { 
          message: error.message || 'Sorry, I encountered an error. Please try again.' 
        } 
      });
    } finally {
      res.end();
    }
  }

  async getConversationHistory(req, res, next) {
    try {
      const { conversationId } = req.params;
      const { user_id: userId } = req.user;

      const history = await this.chatHistory.getConversationHistory(conversationId, userId);
      
      res.json({
        conversationId,
        messages: history
      });
    } catch (error) {
      console.error('Error fetching conversation history:', error);
      next(error);
    }
  }

  async getConversationList(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const conversations = await this.chatHistory.getUserConversations(userId);
      
      res.json({
        conversations
      });
    } catch (error) {
      console.error('Error fetching conversations:', error);
      next(error);
    }
  }

  async deleteConversation(req, res, next) {
    try {
      const { conversationId } = req.params;
      const { user_id: userId } = req.user;

      await this.chatHistory.deleteConversation(conversationId, userId);
      
      res.json({
        message: 'Conversation deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting conversation:', error);
      next(error);
    }
  }

  async getChatAnalytics(req, res, next) {
    try {
      const { user_id: userId } = req.user;
      const { timeframe = 'week' } = req.query;

      const analytics = await this.chatHistory.getChatAnalytics(userId, timeframe);
      
      res.json({
        analytics,
        timeframe
      });
    } catch (error) {
      console.error('Error fetching chat analytics:', error);
      next(error);
    }
  }

  async logChatAnalytics(data) {
    try {
      // Log to database for analytics
      const { userId, storeId, intentCategory, processingTime, confidence, messageLength } = data;
      
      await this.chatHistory.logAnalytics({
        user_id: userId,
        question_category: intentCategory,
        user_satisfaction: null, // To be collected later via feedback
        was_helpful: null, // To be collected later via feedback  
        follow_up_action: null,
        metadata: {
          processingTime,
          confidence,
          messageLength,
          storeId
        }
      });
    } catch (error) {
      console.error('Analytics logging failed:', error);
      // Don't throw - this is fire and forget
    }
  }
}

module.exports = new ChatController();