class RateLimiter {
  constructor(options) {
    this.database = options.database;
    this.cache = options.cache;
    this.defaultLimits = {
      'products:read': { requests: 100, window: 60 },
      'products:write': { requests: 50, window: 60 },
      'inventory:read': { requests: 200, window: 60 },
      'inventory:write': { requests: 100, window: 60 },
      'orders:read': { requests: 100, window: 60 },
      'orders:write': { requests: 50, window: 60 },
      ...options.defaultLimits
    };
    this.channelLimits = new Map();
  }

  async checkLimit(channelId, operation) {
    const limit = await this._getLimit(channelId, operation);
    const key = `ratelimit:${channelId}:${operation}`;
    const now = Date.now();
    const windowStart = now - (limit.window * 1000);

    if (this.cache) {
      const current = await this.cache.get(key) || [];
      const validRequests = current.filter(timestamp => timestamp > windowStart);
      
      if (validRequests.length >= limit.requests) {
        const oldestRequest = Math.min(...validRequests);
        const resetTime = oldestRequest + (limit.window * 1000);
        const waitTime = resetTime - now;
        
        throw new RateLimitError(
          `Rate limit exceeded for ${operation}`,
          {
            limit: limit.requests,
            window: limit.window,
            resetTime: new Date(resetTime),
            waitTime
          }
        );
      }

      validRequests.push(now);
      await this.cache.set(key, validRequests, { ttl: limit.window });
    } else {
      await this._checkLimitWithDatabase(channelId, operation, limit, now, windowStart);
    }

    await this._logRateLimit(channelId, operation);
  }

  async setChannelLimit(channelId, operation, limit) {
    const key = `${channelId}:${operation}`;
    this.channelLimits.set(key, limit);
    
    await this.database.upsert(
      'channel_rate_limits',
      {
        channel_id: channelId,
        operation,
        requests_per_window: limit.requests,
        window_seconds: limit.window,
        updated_at: new Date()
      },
      ['channel_id', 'operation']
    );
  }

  async getStatus(channelId) {
    const operations = Object.keys(this.defaultLimits);
    const status = {};

    for (const operation of operations) {
      const limit = await this._getLimit(channelId, operation);
      const key = `ratelimit:${channelId}:${operation}`;
      
      if (this.cache) {
        const current = await this.cache.get(key) || [];
        const now = Date.now();
        const windowStart = now - (limit.window * 1000);
        const validRequests = current.filter(timestamp => timestamp > windowStart);
        
        status[operation] = {
          limit: limit.requests,
          window: limit.window,
          used: validRequests.length,
          remaining: Math.max(0, limit.requests - validRequests.length),
          resetTime: validRequests.length > 0 
            ? new Date(Math.min(...validRequests) + (limit.window * 1000))
            : null
        };
      } else {
        const usage = await this._getUsageFromDatabase(channelId, operation, limit);
        status[operation] = usage;
      }
    }

    return status;
  }

  async reset(channelId, operation) {
    if (operation) {
      const key = `ratelimit:${channelId}:${operation}`;
      if (this.cache) {
        await this.cache.del(key);
      }
      await this._resetInDatabase(channelId, operation);
    } else {
      const operations = Object.keys(this.defaultLimits);
      for (const op of operations) {
        const key = `ratelimit:${channelId}:${op}`;
        if (this.cache) {
          await this.cache.del(key);
        }
      }
      await this._resetInDatabase(channelId);
    }
  }

  async _getLimit(channelId, operation) {
    const key = `${channelId}:${operation}`;
    
    if (this.channelLimits.has(key)) {
      return this.channelLimits.get(key);
    }

    const customLimit = await this.database.queryOne(
      `SELECT requests_per_window, window_seconds 
       FROM channel_rate_limits 
       WHERE channel_id = $1 AND operation = $2`,
      [channelId, operation]
    );

    if (customLimit) {
      const limit = {
        requests: customLimit.requests_per_window,
        window: customLimit.window_seconds
      };
      this.channelLimits.set(key, limit);
      return limit;
    }

    return this.defaultLimits[operation] || {
      requests: 100,
      window: 60
    };
  }

  async _checkLimitWithDatabase(channelId, operation, limit, now, windowStart) {
    const count = await this.database.queryOne(
      `SELECT COUNT(*) as count 
       FROM channel_rate_limit_logs 
       WHERE channel_id = $1 
       AND operation = $2 
       AND timestamp > $3`,
      [channelId, operation, new Date(windowStart)]
    );

    if (parseInt(count.count) >= limit.requests) {
      const oldestRequest = await this.database.queryOne(
        `SELECT MIN(timestamp) as oldest 
         FROM channel_rate_limit_logs 
         WHERE channel_id = $1 
         AND operation = $2 
         AND timestamp > $3`,
        [channelId, operation, new Date(windowStart)]
      );
      
      const resetTime = new Date(oldestRequest.oldest).getTime() + (limit.window * 1000);
      const waitTime = resetTime - now;
      
      throw new RateLimitError(
        `Rate limit exceeded for ${operation}`,
        {
          limit: limit.requests,
          window: limit.window,
          resetTime: new Date(resetTime),
          waitTime
        }
      );
    }
  }

  async _logRateLimit(channelId, operation) {
    if (this.database) {
      await this.database.insert('channel_rate_limit_logs', {
        channel_id: channelId,
        operation,
        timestamp: new Date()
      });
      
      await this.database.query(
        `DELETE FROM channel_rate_limit_logs 
         WHERE channel_id = $1 
         AND operation = $2 
         AND timestamp < $3`,
        [channelId, operation, new Date(Date.now() - 3600000)]
      );
    }
  }

  async _getUsageFromDatabase(channelId, operation, limit) {
    const now = Date.now();
    const windowStart = now - (limit.window * 1000);
    
    const count = await this.database.queryOne(
      `SELECT COUNT(*) as count 
       FROM channel_rate_limit_logs 
       WHERE channel_id = $1 
       AND operation = $2 
       AND timestamp > $3`,
      [channelId, operation, new Date(windowStart)]
    );

    const used = parseInt(count.count);
    
    let resetTime = null;
    if (used > 0) {
      const oldestRequest = await this.database.queryOne(
        `SELECT MIN(timestamp) as oldest 
         FROM channel_rate_limit_logs 
         WHERE channel_id = $1 
         AND operation = $2 
         AND timestamp > $3`,
        [channelId, operation, new Date(windowStart)]
      );
      
      resetTime = new Date(
        new Date(oldestRequest.oldest).getTime() + (limit.window * 1000)
      );
    }

    return {
      limit: limit.requests,
      window: limit.window,
      used,
      remaining: Math.max(0, limit.requests - used),
      resetTime
    };
  }

  async _resetInDatabase(channelId, operation) {
    if (operation) {
      await this.database.query(
        `DELETE FROM channel_rate_limit_logs 
         WHERE channel_id = $1 AND operation = $2`,
        [channelId, operation]
      );
    } else {
      await this.database.query(
        `DELETE FROM channel_rate_limit_logs 
         WHERE channel_id = $1`,
        [channelId]
      );
    }
  }

  async getUsageStats(channelId, period = '1h') {
    const since = this._calculateSinceDate(period);
    
    const stats = await this.database.query(
      `SELECT 
        operation,
        DATE_TRUNC('minute', timestamp) as minute,
        COUNT(*) as requests
       FROM channel_rate_limit_logs
       WHERE channel_id = $1 AND timestamp > $2
       GROUP BY operation, minute
       ORDER BY minute DESC`,
      [channelId, since]
    );

    const result = {};
    
    for (const row of stats) {
      if (!result[row.operation]) {
        result[row.operation] = [];
      }
      
      result[row.operation].push({
        timestamp: row.minute,
        requests: parseInt(row.requests)
      });
    }

    return result;
  }

  _calculateSinceDate(period) {
    const match = period.match(/^(\d+)([dhm])$/);
    if (!match) {
      throw new Error(`Invalid period format: ${period}`);
    }
    
    const [, value, unit] = match;
    const now = new Date();
    
    switch (unit) {
      case 'd':
        now.setDate(now.getDate() - parseInt(value));
        break;
      case 'h':
        now.setHours(now.getHours() - parseInt(value));
        break;
      case 'm':
        now.setMinutes(now.getMinutes() - parseInt(value));
        break;
    }
    
    return now;
  }
}

class RateLimitError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'RateLimitError';
    this.details = details;
  }
}

module.exports = RateLimiter;