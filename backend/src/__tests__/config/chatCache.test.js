const { chatCache, CHAT_CACHE_TTL, redisClient } = require("../../../config/redis");

// Mock Redis client
jest.mock("redis", () => ({
  createClient: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(true),
    setEx: jest.fn().mockResolvedValue("OK"),
    get: jest.fn(),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  }))
}));

describe("Chat Cache Functions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Context Caching", () => {
    it("should set context with correct TTL", async () => {
      const userId = "user123";
      const storeId = "store456";
      const context = { inventory: { totalProducts: 100 }, forecasts: [] };

      await chatCache.setContext(userId, storeId, context);

      expect(redisClient.setEx).toHaveBeenCalledWith(
        `chat:context:${userId}:${storeId}`,
        CHAT_CACHE_TTL.CONTEXT,
        JSON.stringify(context)
      );
    });

    it("should get cached context", async () => {
      const userId = "user123";
      const storeId = "store456";
      const context = { inventory: { totalProducts: 100 }, forecasts: [] };
      
      redisClient.get.mockResolvedValueOnce(JSON.stringify(context));

      const result = await chatCache.getContext(userId, storeId);

      expect(redisClient.get).toHaveBeenCalledWith(`chat:context:${userId}:${storeId}`);
      expect(result).toEqual(context);
    });

    it("should return null when context not found", async () => {
      redisClient.get.mockResolvedValueOnce(null);

      const result = await chatCache.getContext("user123", "store456");

      expect(result).toBeNull();
    });
  });

  describe("Conversation Caching", () => {
    it("should set conversation with correct TTL", async () => {
      const conversationId = "conv123";
      const messages = [
        { type: "user", content: "Hello" },
        { type: "assistant", content: "Hi there!" }
      ];

      await chatCache.setConversation(conversationId, messages);

      expect(redisClient.setEx).toHaveBeenCalledWith(
        `chat:conversation:${conversationId}`,
        CHAT_CACHE_TTL.CONVERSATION,
        JSON.stringify(messages)
      );
    });

    it("should get cached conversation", async () => {
      const conversationId = "conv123";
      const messages = [
        { type: "user", content: "Hello" },
        { type: "assistant", content: "Hi there!" }
      ];
      
      redisClient.get.mockResolvedValueOnce(JSON.stringify(messages));

      const result = await chatCache.getConversation(conversationId);

      expect(redisClient.get).toHaveBeenCalledWith(`chat:conversation:${conversationId}`);
      expect(result).toEqual(messages);
    });

    it("should invalidate conversation cache", async () => {
      const conversationId = "conv123";

      await chatCache.invalidateConversation(conversationId);

      expect(redisClient.del).toHaveBeenCalledWith(`chat:conversation:${conversationId}`);
    });
  });

  describe("User Stats Caching", () => {
    it("should set user stats with correct TTL", async () => {
      const userId = "user123";
      const stats = { messagesCount: 10, averageResponseTime: 1500 };

      await chatCache.setUserStats(userId, stats);

      expect(redisClient.setEx).toHaveBeenCalledWith(
        `chat:stats:${userId}`,
        CHAT_CACHE_TTL.USER_STATS,
        JSON.stringify(stats)
      );
    });

    it("should get cached user stats", async () => {
      const userId = "user123";
      const stats = { messagesCount: 10, averageResponseTime: 1500 };
      
      redisClient.get.mockResolvedValueOnce(JSON.stringify(stats));

      const result = await chatCache.getUserStats(userId);

      expect(redisClient.get).toHaveBeenCalledWith(`chat:stats:${userId}`);
      expect(result).toEqual(stats);
    });
  });

  describe("Rate Limiting", () => {
    it("should increment user requests with proper expiration", async () => {
      const userId = "user123";
      const date = new Date().toISOString().split('T')[0];
      const minute = Math.floor(Date.now() / 60000);

      await chatCache.incrementUserRequests(userId);

      expect(redisClient.incr).toHaveBeenCalledWith(`chat:requests:${userId}:${date}`);
      expect(redisClient.expire).toHaveBeenCalledWith(`chat:requests:${userId}:${date}`, 86400);
      
      expect(redisClient.incr).toHaveBeenCalledWith(`chat:requests:${userId}:minute:${minute}`);
      expect(redisClient.expire).toHaveBeenCalledWith(`chat:requests:${userId}:minute:${minute}`, 60);
    });

    it("should get user request counts", async () => {
      const userId = "user123";
      
      redisClient.get.mockResolvedValueOnce("50"); // daily
      redisClient.get.mockResolvedValueOnce("5");  // per minute

      const result = await chatCache.getUserRequestCounts(userId);

      expect(result).toEqual({
        daily: 50,
        perMinute: 5
      });
    });

    it("should handle missing request counts", async () => {
      const userId = "user123";
      
      redisClient.get.mockResolvedValueOnce(null); // daily
      redisClient.get.mockResolvedValueOnce(null); // per minute

      const result = await chatCache.getUserRequestCounts(userId);

      expect(result).toEqual({
        daily: 0,
        perMinute: 0
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle JSON parse errors gracefully", async () => {
      redisClient.get.mockResolvedValueOnce("invalid json");

      await expect(chatCache.getContext("user123", "store456")).rejects.toThrow();
    });

    it("should handle Redis connection errors", async () => {
      redisClient.setEx.mockRejectedValueOnce(new Error("Redis connection error"));

      await expect(chatCache.setContext("user123", "store456", {})).rejects.toThrow("Redis connection error");
    });
  });
});