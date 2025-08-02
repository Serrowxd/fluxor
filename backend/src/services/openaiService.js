const OpenAI = require('openai');

class OpenAIService {
  constructor(apiKey) {
    this.openai = new OpenAI({
      apiKey: apiKey
    });
    
    this.rateLimiter = new Map();
    this.rateLimitConfig = {
      requestsPerMinute: parseInt(process.env.CHAT_RATE_LIMIT_PER_MINUTE || '20'),
      requestsPerDay: parseInt(process.env.CHAT_RATE_LIMIT_PER_DAY || '200'),
      tokensPerDay: parseInt(process.env.CHAT_MAX_TOKENS_PER_DAY || '5000')
    };
  }

  async generateChatResponse(prompt, config, userId) {
    await this.enforceRateLimit(userId);
    
    const startTime = Date.now();
    
    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a helpful inventory management expert specializing in small business needs. Always provide specific, actionable advice based on the data provided."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        top_p: 0.9,
        frequency_penalty: 0.1,
        presence_penalty: 0.1
      });

      const responseTimeMs = Date.now() - startTime;
      const content = completion.choices[0]?.message?.content || "I apologize, but I couldn't generate a response. Please try again.";
      const tokensUsed = completion.usage?.total_tokens || 0;

      await this.updateTokenUsage(userId, tokensUsed);

      const confidence = this.calculateResponseConfidence(content, tokensUsed, responseTimeMs);

      return {
        content,
        tokensUsed,
        responseTimeMs,
        confidence
      };
      
    } catch (error) {
      console.error('OpenAI API error:', error);
      
      if (error?.status === 429) {
        throw new Error('OpenAI rate limit exceeded. Please try again later.');
      }
      
      if (error?.status === 401) {
        throw new Error('OpenAI authentication failed. Please check API key configuration.');
      }
      
      return {
        content: "I'm having trouble accessing my AI capabilities right now. Please try again in a moment, or check your dashboard for the latest inventory data.",
        tokensUsed: 0,
        responseTimeMs: Date.now() - startTime,
        confidence: 0
      };
    }
  }

  async enforceRateLimit(userId) {
    const tracker = this.getOrCreateTracker(userId);
    const now = Date.now();
    
    this.resetTrackerIfNeeded(tracker, now);
    
    if (tracker.requestsThisMinute >= this.rateLimitConfig.requestsPerMinute) {
      const waitTime = 60000 - (now - tracker.lastResetMinute);
      throw new Error(`Rate limit exceeded: Too many requests per minute. Please wait ${Math.ceil(waitTime / 1000)} seconds.`);
    }
    
    if (tracker.requestsToday >= this.rateLimitConfig.requestsPerDay) {
      throw new Error('Rate limit exceeded: Daily request limit reached.');
    }
    
    if (tracker.tokensToday >= this.rateLimitConfig.tokensPerDay) {
      throw new Error('Rate limit exceeded: Daily token limit reached.');
    }

    tracker.requestsThisMinute++;
    tracker.requestsToday++;
    this.rateLimiter.set(userId, tracker);
  }

  async updateTokenUsage(userId, tokensUsed) {
    const tracker = this.getOrCreateTracker(userId);
    tracker.tokensToday += tokensUsed;
    this.rateLimiter.set(userId, tracker);
  }

  getOrCreateTracker(userId) {
    const existing = this.rateLimiter.get(userId);
    if (existing) {
      return existing;
    }
    
    const newTracker = this.createRateLimitTracker();
    this.rateLimiter.set(userId, newTracker);
    return newTracker;
  }

  createRateLimitTracker() {
    const now = Date.now();
    return {
      requestsThisMinute: 0,
      requestsToday: 0,
      tokensToday: 0,
      lastResetMinute: now,
      lastResetDay: now
    };
  }

  resetTrackerIfNeeded(tracker, now) {
    const minuteElapsed = now - tracker.lastResetMinute >= 60000;
    const dayElapsed = now - tracker.lastResetDay >= 86400000;
    
    if (minuteElapsed) {
      tracker.requestsThisMinute = 0;
      tracker.lastResetMinute = now;
    }
    
    if (dayElapsed) {
      tracker.requestsToday = 0;
      tracker.tokensToday = 0;
      tracker.lastResetDay = now;
    }
  }

  calculateResponseConfidence(content, tokensUsed, responseTime) {
    let confidence = 85;
    
    if (content.length < 50) {
      confidence -= 20;
    }
    
    if (responseTime > 5000) {
      confidence -= 10;
    }
    
    if (content.includes("I don't have enough information") || 
        content.includes("Please provide more details") ||
        content.includes("I apologize") ||
        content.includes("unavailable")) {
      confidence -= 30;
    }
    
    if (/\d+/.test(content)) {
      confidence += 10;
    }
    
    if (content.includes("recommend") || content.includes("suggest")) {
      confidence += 5;
    }

    if (tokensUsed > 150 && tokensUsed < 250) {
      confidence += 5;
    }

    return Math.max(0, Math.min(100, confidence));
  }

  getRateLimitStatus(userId) {
    const tracker = this.rateLimiter.get(userId);
    if (!tracker) {
      return {
        requestsRemaining: this.rateLimitConfig.requestsPerMinute,
        tokensRemaining: this.rateLimitConfig.tokensPerDay,
        resetsInMinutes: 1,
        resetsInHours: 24
      };
    }

    const now = Date.now();
    this.resetTrackerIfNeeded(tracker, now);

    const minutesUntilReset = Math.ceil((60000 - (now - tracker.lastResetMinute)) / 60000);
    const hoursUntilDailyReset = Math.ceil((86400000 - (now - tracker.lastResetDay)) / 3600000);

    return {
      requestsRemaining: Math.max(0, this.rateLimitConfig.requestsPerMinute - tracker.requestsThisMinute),
      tokensRemaining: Math.max(0, this.rateLimitConfig.tokensPerDay - tracker.tokensToday),
      resetsInMinutes: minutesUntilReset,
      resetsInHours: hoursUntilDailyReset
    };
  }

  clearUserRateLimit(userId) {
    this.rateLimiter.delete(userId);
  }

  async testConnection() {
    try {
      const response = await this.openai.models.list();
      return response.data.length > 0;
    } catch (error) {
      console.error('OpenAI connection test failed:', error);
      return false;
    }
  }
}

module.exports = { OpenAIService };