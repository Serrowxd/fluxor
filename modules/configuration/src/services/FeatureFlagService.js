const { FeatureFlagStatus, FeatureFlagStrategy } = require('../types');

class FeatureFlagService {
  constructor(config = {}, dependencies = {}) {
    this.config = config;
    this.database = dependencies.database;
    this.cache = dependencies.cache;
    this.eventBus = dependencies.eventBus;
    this.tableName = config.tableName || 'feature_flags';
    this.evaluationCache = new Map();
    this.strategies = new Map();
    
    // Register default strategies
    this.registerDefaultStrategies();
  }

  async initialize() {
    if (this.database) {
      await this.ensureSchema();
    }

    // Load custom strategies
    if (this.config.strategies) {
      for (const [name, strategy] of Object.entries(this.config.strategies)) {
        this.registerStrategy(name, strategy);
      }
    }
  }

  async ensureSchema() {
    const schema = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'disabled',
        strategy VARCHAR(50) DEFAULT 'boolean',
        rules JSONB DEFAULT '{}',
        tags TEXT[],
        metadata JSONB DEFAULT '{}',
        enabled_at TIMESTAMP,
        disabled_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(255),
        updated_by VARCHAR(255)
      );

      CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON ${this.tableName}(key);
      CREATE INDEX IF NOT EXISTS idx_feature_flags_status ON ${this.tableName}(status);
      CREATE INDEX IF NOT EXISTS idx_feature_flags_tags ON ${this.tableName} USING GIN(tags);

      CREATE TABLE IF NOT EXISTS ${this.tableName}_evaluations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        flag_key VARCHAR(255) NOT NULL,
        user_id VARCHAR(255),
        tenant_id VARCHAR(255),
        context JSONB DEFAULT '{}',
        enabled BOOLEAN NOT NULL,
        strategy VARCHAR(50),
        variant VARCHAR(255),
        reason TEXT,
        metadata JSONB DEFAULT '{}',
        evaluated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_flag_evaluations (flag_key, evaluated_at DESC),
        INDEX idx_user_evaluations (user_id, evaluated_at DESC)
      );
    `;

    await this.database.execute(schema);
  }

  registerDefaultStrategies() {
    // Boolean strategy - simple on/off
    this.registerStrategy(FeatureFlagStrategy.BOOLEAN, {
      evaluate: async (rules, context) => {
        return {
          enabled: rules.enabled === true,
          reason: rules.enabled ? 'Feature is enabled' : 'Feature is disabled'
        };
      }
    });

    // Percentage strategy - gradual rollout
    this.registerStrategy(FeatureFlagStrategy.PERCENTAGE, {
      evaluate: async (rules, context) => {
        const percentage = rules.percentage || 0;
        const identifier = context.userId || context.sessionId || context.ip;
        
        if (!identifier) {
          return {
            enabled: false,
            reason: 'No identifier provided for percentage evaluation'
          };
        }

        const hash = this.hashString(identifier + (rules.salt || ''));
        const bucket = Math.abs(hash) % 100;
        const enabled = bucket < percentage;

        return {
          enabled,
          reason: `User in bucket ${bucket}, threshold ${percentage}`
        };
      }
    });

    // User list strategy - specific users
    this.registerStrategy(FeatureFlagStrategy.USER_LIST, {
      evaluate: async (rules, context) => {
        const userList = rules.users || [];
        const userId = context.userId;

        if (!userId) {
          return {
            enabled: false,
            reason: 'No userId provided for user list evaluation'
          };
        }

        const enabled = userList.includes(userId);
        return {
          enabled,
          reason: enabled ? 'User is in the list' : 'User is not in the list'
        };
      }
    });

    // Group strategy - based on user attributes
    this.registerStrategy(FeatureFlagStrategy.GROUP, {
      evaluate: async (rules, context) => {
        const groups = rules.groups || [];
        
        for (const group of groups) {
          if (this.matchesGroup(context, group)) {
            return {
              enabled: true,
              reason: `Matches group: ${group.name || 'unnamed'}`
            };
          }
        }

        return {
          enabled: false,
          reason: 'No matching groups'
        };
      }
    });

    // Gradual rollout strategy - time-based
    this.registerStrategy(FeatureFlagStrategy.GRADUAL, {
      evaluate: async (rules, context) => {
        const startDate = rules.startDate ? new Date(rules.startDate) : null;
        const endDate = rules.endDate ? new Date(rules.endDate) : null;
        const now = new Date();

        if (!startDate || !endDate) {
          return {
            enabled: false,
            reason: 'Invalid gradual rollout configuration'
          };
        }

        if (now < startDate) {
          return {
            enabled: false,
            reason: 'Rollout has not started yet'
          };
        }

        if (now > endDate) {
          return {
            enabled: true,
            reason: 'Rollout is complete'
          };
        }

        // Calculate percentage based on time
        const totalTime = endDate.getTime() - startDate.getTime();
        const elapsedTime = now.getTime() - startDate.getTime();
        const percentage = Math.floor((elapsedTime / totalTime) * 100);

        // Use percentage strategy
        const percentageStrategy = this.strategies.get(FeatureFlagStrategy.PERCENTAGE);
        return percentageStrategy.evaluate(
          { percentage, salt: rules.salt },
          context
        );
      }
    });
  }

  registerStrategy(name, strategy) {
    this.strategies.set(name, strategy);
  }

  async createFlag(flag) {
    const query = `
      INSERT INTO ${this.tableName} (
        key, name, description, status, strategy, 
        rules, tags, metadata, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const params = [
      flag.key,
      flag.name,
      flag.description,
      flag.status || FeatureFlagStatus.DISABLED,
      flag.strategy || FeatureFlagStrategy.BOOLEAN,
      JSON.stringify(flag.rules || {}),
      flag.tags || [],
      JSON.stringify(flag.metadata || {}),
      flag.userId
    ];

    const result = await this.database.query(query, params);
    const created = result.rows[0];

    // Clear cache
    await this.clearCache(flag.key);

    // Emit event
    if (this.eventBus) {
      await this.eventBus.emit('featureflag.created', created);
    }

    return created;
  }

  async updateFlag(key, updates) {
    const sets = [];
    const params = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      sets.push(`name = $${paramIndex}`);
      params.push(updates.name);
      paramIndex++;
    }

    if (updates.description !== undefined) {
      sets.push(`description = $${paramIndex}`);
      params.push(updates.description);
      paramIndex++;
    }

    if (updates.status !== undefined) {
      sets.push(`status = $${paramIndex}`);
      params.push(updates.status);
      paramIndex++;

      // Update enabled/disabled timestamps
      if (updates.status === FeatureFlagStatus.ENABLED) {
        sets.push(`enabled_at = CURRENT_TIMESTAMP`);
      } else if (updates.status === FeatureFlagStatus.DISABLED) {
        sets.push(`disabled_at = CURRENT_TIMESTAMP`);
      }
    }

    if (updates.strategy !== undefined) {
      sets.push(`strategy = $${paramIndex}`);
      params.push(updates.strategy);
      paramIndex++;
    }

    if (updates.rules !== undefined) {
      sets.push(`rules = $${paramIndex}`);
      params.push(JSON.stringify(updates.rules));
      paramIndex++;
    }

    if (updates.tags !== undefined) {
      sets.push(`tags = $${paramIndex}`);
      params.push(updates.tags);
      paramIndex++;
    }

    if (updates.metadata !== undefined) {
      sets.push(`metadata = $${paramIndex}`);
      params.push(JSON.stringify(updates.metadata));
      paramIndex++;
    }

    sets.push(`updated_at = CURRENT_TIMESTAMP`);

    if (updates.userId) {
      sets.push(`updated_by = $${paramIndex}`);
      params.push(updates.userId);
      paramIndex++;
    }

    const query = `
      UPDATE ${this.tableName}
      SET ${sets.join(', ')}
      WHERE key = $${paramIndex}
      RETURNING *
    `;
    params.push(key);

    const result = await this.database.query(query, params);
    const updated = result.rows[0];

    // Clear cache
    await this.clearCache(key);

    // Emit event
    if (this.eventBus) {
      await this.eventBus.emit('featureflag.updated', {
        key,
        changes: updates,
        flag: updated
      });
    }

    return updated;
  }

  async deleteFlag(key) {
    const query = `DELETE FROM ${this.tableName} WHERE key = $1`;
    await this.database.query(query, [key]);

    // Clear cache
    await this.clearCache(key);

    // Emit event
    if (this.eventBus) {
      await this.eventBus.emit('featureflag.deleted', { key });
    }
  }

  async getFlag(key) {
    // Check cache first
    if (this.cache) {
      const cached = await this.cache.get(`featureflag:${key}`);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    const query = `SELECT * FROM ${this.tableName} WHERE key = $1`;
    const result = await this.database.query(query, [key]);

    if (result.rows.length === 0) {
      return null;
    }

    const flag = result.rows[0];

    // Cache the result
    if (this.cache) {
      await this.cache.set(
        `featureflag:${key}`,
        JSON.stringify(flag),
        this.config.cacheTTL || 300
      );
    }

    return flag;
  }

  async listFlags(options = {}) {
    const { status, tags, limit = 100, offset = 0 } = options;
    
    let query = `SELECT * FROM ${this.tableName} WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (tags && tags.length > 0) {
      query += ` AND tags && $${paramIndex}`;
      params.push(tags);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await this.database.query(query, params);
    return result.rows;
  }

  async evaluate(key, context = {}) {
    const flag = await this.getFlag(key);

    if (!flag) {
      return {
        key,
        enabled: false,
        reason: 'Feature flag not found'
      };
    }

    if (flag.status === FeatureFlagStatus.DISABLED) {
      return {
        key,
        enabled: false,
        reason: 'Feature flag is disabled'
      };
    }

    // Get strategy
    const strategy = this.strategies.get(flag.strategy);
    if (!strategy) {
      return {
        key,
        enabled: false,
        reason: `Unknown strategy: ${flag.strategy}`
      };
    }

    // Evaluate
    const evaluation = await strategy.evaluate(flag.rules || {}, context);

    // Record evaluation if configured
    if (this.config.recordEvaluations) {
      await this.recordEvaluation(key, context, evaluation);
    }

    return {
      key,
      ...evaluation,
      strategy: flag.strategy
    };
  }

  async evaluateAll(context = {}) {
    const flags = await this.listFlags();
    const evaluations = {};

    for (const flag of flags) {
      const evaluation = await this.evaluate(flag.key, context);
      evaluations[flag.key] = evaluation;
    }

    return evaluations;
  }

  async recordEvaluation(flagKey, context, evaluation) {
    if (!this.database) {
      return;
    }

    const query = `
      INSERT INTO ${this.tableName}_evaluations (
        flag_key, user_id, tenant_id, context, 
        enabled, strategy, variant, reason, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    const params = [
      flagKey,
      context.userId,
      context.tenantId,
      JSON.stringify(context),
      evaluation.enabled,
      evaluation.strategy,
      evaluation.variant,
      evaluation.reason,
      JSON.stringify(evaluation.metadata || {})
    ];

    try {
      await this.database.query(query, params);
    } catch (error) {
      console.error('Failed to record feature flag evaluation:', error);
    }
  }

  async getEvaluationStats(flagKey, timeRange = '24 hours') {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN enabled = true THEN 1 END) as enabled_count,
        COUNT(CASE WHEN enabled = false THEN 1 END) as disabled_count,
        COUNT(DISTINCT user_id) as unique_users,
        strategy,
        variant
      FROM ${this.tableName}_evaluations
      WHERE flag_key = $1 
        AND evaluated_at > NOW() - INTERVAL '${timeRange}'
      GROUP BY strategy, variant
    `;

    const result = await this.database.query(query, [flagKey]);
    
    return {
      flagKey,
      timeRange,
      stats: result.rows
    };
  }

  matchesGroup(context, group) {
    if (!group.conditions) {
      return false;
    }

    for (const condition of group.conditions) {
      const contextValue = this.getNestedValue(context, condition.attribute);
      
      if (!this.evaluateCondition(contextValue, condition.operator, condition.value)) {
        if (group.operator === 'AND') {
          return false;
        }
      } else if (group.operator === 'OR') {
        return true;
      }
    }

    return group.operator === 'AND';
  }

  evaluateCondition(contextValue, operator, targetValue) {
    switch (operator) {
      case 'equals':
        return contextValue === targetValue;
      case 'notEquals':
        return contextValue !== targetValue;
      case 'contains':
        return String(contextValue).includes(targetValue);
      case 'notContains':
        return !String(contextValue).includes(targetValue);
      case 'in':
        return Array.isArray(targetValue) && targetValue.includes(contextValue);
      case 'notIn':
        return Array.isArray(targetValue) && !targetValue.includes(contextValue);
      case 'greaterThan':
        return Number(contextValue) > Number(targetValue);
      case 'lessThan':
        return Number(contextValue) < Number(targetValue);
      case 'regex':
        return new RegExp(targetValue).test(String(contextValue));
      default:
        return false;
    }
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  getNestedValue(obj, path) {
    const segments = path.split('.');
    let current = obj;
    
    for (const segment of segments) {
      if (current && typeof current === 'object' && segment in current) {
        current = current[segment];
      } else {
        return undefined;
      }
    }
    
    return current;
  }

  async clearCache(key) {
    if (this.cache) {
      await this.cache.delete(`featureflag:${key}`);
    }
    this.evaluationCache.delete(key);
  }

  async clearAllCache() {
    if (this.cache) {
      // Clear all feature flag keys from cache
      const pattern = 'featureflag:*';
      await this.cache.deletePattern(pattern);
    }
    this.evaluationCache.clear();
  }
}

module.exports = FeatureFlagService;