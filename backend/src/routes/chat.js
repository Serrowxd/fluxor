const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { authenticateToken } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// Chat-specific rate limiter
const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute per IP
  message: 'Too many chat requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation middleware for chat input
const validateChatInput = (req, res, next) => {
  const { message, conversationId } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required and must be a string' });
  }

  if (message.trim().length === 0) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  if (message.length > 1000) {
    return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
  }

  if (conversationId && typeof conversationId !== 'string') {
    return res.status(400).json({ error: 'conversationId must be a string' });
  }

  next();
};

// Apply authentication to all chat routes
router.use(authenticateToken);

// Apply rate limiting to all chat routes
router.use(chatRateLimiter);

// Send a chat message
router.post('/message', 
  validateChatInput,
  chatController.sendMessage.bind(chatController)
);

// Stream chat message (for real-time typing)
router.post('/stream', 
  validateChatInput,
  chatController.streamMessage.bind(chatController)
);

// Get conversation history
router.get('/conversation/:conversationId', 
  chatController.getConversationHistory.bind(chatController)
);

// Get user's conversations
router.get('/conversations', 
  chatController.getConversationList.bind(chatController)
);

// Delete conversation
router.delete('/conversation/:conversationId',
  chatController.deleteConversation.bind(chatController)
);

// Get chat analytics
router.get('/analytics',
  chatController.getChatAnalytics.bind(chatController)
);

module.exports = router;