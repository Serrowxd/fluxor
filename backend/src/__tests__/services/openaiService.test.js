const { OpenAIService } = require('../../services/openaiService');

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => {
    return {
      chat: {
        completions: {
          create: jest.fn()
        }
      },
      models: {
        list: jest.fn()
      }
    };
  });
});

describe('OpenAIService', () => {
  let openaiService;
  let mockOpenAI;
  const mockApiKey = 'test-api-key';
  const mockUserId = 'user123';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CHAT_RATE_LIMIT_PER_MINUTE = '10';
    process.env.CHAT_RATE_LIMIT_PER_DAY = '100';
    process.env.CHAT_MAX_TOKENS_PER_DAY = '1000';
    
    openaiService = new OpenAIService(mockApiKey);
    mockOpenAI = require('openai');
  });

  afterEach(() => {
    delete process.env.CHAT_RATE_LIMIT_PER_MINUTE;
    delete process.env.CHAT_RATE_LIMIT_PER_DAY;
    delete process.env.CHAT_MAX_TOKENS_PER_DAY;
  });

  describe('generateChatResponse', () => {
    const mockPrompt = 'Test prompt';
    const mockConfig = {
      name: 'test',
      template: 'test template',
      maxTokens: 200,
      temperature: 0.3
    };

    it('should handle API responses successfully', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'This is a helpful response about inventory management.'
          }
        }],
        usage: {
          total_tokens: 50
        }
      };

      openaiService.openai.chat.completions.create.mockResolvedValue(mockResponse);

      const result = await openaiService.generateChatResponse(mockPrompt, mockConfig, mockUserId);

      expect(result.content).toBe('This is a helpful response about inventory management.');
      expect(result.tokensUsed).toBe(50);
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(100);
    });

    it('should enforce rate limits per minute', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { total_tokens: 10 }
      };

      openaiService.openai.chat.completions.create.mockResolvedValue(mockResponse);

      for (let i = 0; i < 10; i++) {
        await openaiService.generateChatResponse(mockPrompt, mockConfig, mockUserId);
      }

      await expect(
        openaiService.generateChatResponse(mockPrompt, mockConfig, mockUserId)
      ).rejects.toThrow(/Rate limit exceeded: Too many requests per minute/);
    });

    it('should enforce daily request limits', async () => {
      openaiService.clearUserRateLimit(mockUserId);
      
      const tracker = {
        requestsThisMinute: 0,
        requestsToday: 100,
        tokensToday: 0,
        lastResetMinute: Date.now(),
        lastResetDay: Date.now()
      };
      openaiService.rateLimiter.set(mockUserId, tracker);

      await expect(
        openaiService.generateChatResponse(mockPrompt, mockConfig, mockUserId)
      ).rejects.toThrow('Rate limit exceeded: Daily request limit reached.');
    });

    it('should enforce daily token limits', async () => {
      openaiService.clearUserRateLimit(mockUserId);
      
      const tracker = {
        requestsThisMinute: 0,
        requestsToday: 0,
        tokensToday: 1000,
        lastResetMinute: Date.now(),
        lastResetDay: Date.now()
      };
      openaiService.rateLimiter.set(mockUserId, tracker);

      await expect(
        openaiService.generateChatResponse(mockPrompt, mockConfig, mockUserId)
      ).rejects.toThrow('Rate limit exceeded: Daily token limit reached.');
    });

    it('should provide fallback on API failure', async () => {
      openaiService.openai.chat.completions.create.mockRejectedValue(new Error('API Error'));

      const result = await openaiService.generateChatResponse(mockPrompt, mockConfig, mockUserId);

      expect(result.content).toContain("I'm having trouble accessing my AI capabilities");
      expect(result.tokensUsed).toBe(0);
      expect(result.confidence).toBe(0);
    });

    it('should handle OpenAI rate limit errors', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      rateLimitError.status = 429;
      openaiService.openai.chat.completions.create.mockRejectedValue(rateLimitError);

      await expect(
        openaiService.generateChatResponse(mockPrompt, mockConfig, mockUserId)
      ).rejects.toThrow('OpenAI rate limit exceeded. Please try again later.');
    });

    it('should handle authentication errors', async () => {
      const authError = new Error('Unauthorized');
      authError.status = 401;
      openaiService.openai.chat.completions.create.mockRejectedValue(authError);

      await expect(
        openaiService.generateChatResponse(mockPrompt, mockConfig, mockUserId)
      ).rejects.toThrow('OpenAI authentication failed. Please check API key configuration.');
    });
  });

  describe('calculateResponseConfidence', () => {
    it('should calculate high confidence for good responses', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'Based on your current stock of 50 units and predicted demand of 100 units, I recommend ordering 75 units to maintain optimal inventory levels.'
          }
        }],
        usage: { total_tokens: 180 }
      };

      openaiService.openai.chat.completions.create.mockResolvedValue(mockResponse);

      const result = await openaiService.generateChatResponse('test', { maxTokens: 200, temperature: 0.3 }, mockUserId);
      
      expect(result.confidence).toBeGreaterThan(80);
    });

    it('should calculate low confidence for short responses', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'Not enough data.'
          }
        }],
        usage: { total_tokens: 10 }
      };

      openaiService.openai.chat.completions.create.mockResolvedValue(mockResponse);

      const result = await openaiService.generateChatResponse('test', { maxTokens: 200, temperature: 0.3 }, mockUserId);
      
      expect(result.confidence).toBeLessThan(70);
    });

    it('should reduce confidence for generic responses', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: "I don't have enough information to provide a specific recommendation. Please provide more details about your inventory needs."
          }
        }],
        usage: { total_tokens: 30 }
      };

      openaiService.openai.chat.completions.create.mockResolvedValue(mockResponse);

      const result = await openaiService.generateChatResponse('test', { maxTokens: 200, temperature: 0.3 }, mockUserId);
      
      expect(result.confidence).toBeLessThanOrEqual(60);
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return correct rate limit status', () => {
      openaiService.clearUserRateLimit(mockUserId);
      
      const tracker = {
        requestsThisMinute: 5,
        requestsToday: 50,
        tokensToday: 500,
        lastResetMinute: Date.now(),
        lastResetDay: Date.now()
      };
      openaiService.rateLimiter.set(mockUserId, tracker);

      const status = openaiService.getRateLimitStatus(mockUserId);

      expect(status.requestsRemaining).toBe(5);
      expect(status.tokensRemaining).toBe(500);
      expect(status.resetsInMinutes).toBeGreaterThan(0);
      expect(status.resetsInHours).toBeGreaterThan(0);
    });

    it('should return default status for new users', () => {
      const status = openaiService.getRateLimitStatus('newuser');

      expect(status.requestsRemaining).toBe(10);
      expect(status.tokensRemaining).toBe(1000);
      expect(status.resetsInMinutes).toBe(1);
      expect(status.resetsInHours).toBe(24);
    });
  });

  describe('testConnection', () => {
    it('should return true when connection is successful', async () => {
      openaiService.openai.models.list.mockResolvedValue({
        data: [{ id: 'gpt-3.5-turbo' }]
      });

      const result = await openaiService.testConnection();
      expect(result).toBe(true);
    });

    it('should return false when connection fails', async () => {
      openaiService.openai.models.list.mockRejectedValue(new Error('Connection failed'));

      const result = await openaiService.testConnection();
      expect(result).toBe(false);
    });
  });

  describe('rate limit reset', () => {
    it('should reset minute counter after 60 seconds', async () => {
      openaiService.clearUserRateLimit(mockUserId);
      
      const oneMinuteAgo = Date.now() - 61000;
      const tracker = {
        requestsThisMinute: 10,
        requestsToday: 10,
        tokensToday: 100,
        lastResetMinute: oneMinuteAgo,
        lastResetDay: Date.now()
      };
      openaiService.rateLimiter.set(mockUserId, tracker);

      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { total_tokens: 10 }
      };
      openaiService.openai.chat.completions.create.mockResolvedValue(mockResponse);

      await openaiService.generateChatResponse('test', { maxTokens: 200, temperature: 0.3 }, mockUserId);

      const updatedTracker = openaiService.rateLimiter.get(mockUserId);
      expect(updatedTracker.requestsThisMinute).toBe(1);
    });

    it('should reset daily counters after 24 hours', async () => {
      openaiService.clearUserRateLimit(mockUserId);
      
      const oneDayAgo = Date.now() - 86400001;
      const tracker = {
        requestsThisMinute: 0,
        requestsToday: 100,
        tokensToday: 1000,
        lastResetMinute: Date.now(),
        lastResetDay: oneDayAgo
      };
      openaiService.rateLimiter.set(mockUserId, tracker);

      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { total_tokens: 10 }
      };
      openaiService.openai.chat.completions.create.mockResolvedValue(mockResponse);

      await openaiService.generateChatResponse('test', { maxTokens: 200, temperature: 0.3 }, mockUserId);

      const updatedTracker = openaiService.rateLimiter.get(mockUserId);
      expect(updatedTracker.requestsToday).toBe(1);
      expect(updatedTracker.tokensToday).toBe(10);
    });
  });

  describe('clearUserRateLimit', () => {
    it('should clear user rate limit', () => {
      const tracker = {
        requestsThisMinute: 5,
        requestsToday: 50,
        tokensToday: 500,
        lastResetMinute: Date.now(),
        lastResetDay: Date.now()
      };
      openaiService.rateLimiter.set(mockUserId, tracker);

      openaiService.clearUserRateLimit(mockUserId);

      expect(openaiService.rateLimiter.has(mockUserId)).toBe(false);
    });
  });
});