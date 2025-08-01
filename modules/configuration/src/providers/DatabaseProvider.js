const BaseProvider = require('./BaseProvider');
const { ConfigurationSource, ConfigurationScope } = require('../types');

class DatabaseProvider extends BaseProvider {
  constructor(config = {}, dependencies = {}) {
    super(config);
    this.source = ConfigurationSource.DATABASE;
    this.database = dependencies.database;
    this.tableName = config.tableName || 'configurations';
    this.tenantId = config.tenantId;
    this.scope = config.scope || ConfigurationScope.GLOBAL;
    this.encryptionKey = config.encryptionKey;
  }

  async initialize() {
    if (!this.database) {
      throw new Error('Database dependency is required');
    }

    await this.ensureSchema();
  }

  async ensureSchema() {
    const schema = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key VARCHAR(255) NOT NULL,
        value TEXT,
        type VARCHAR(50) DEFAULT 'string',
        scope VARCHAR(50) DEFAULT 'global',
        scope_id VARCHAR(255),
        description TEXT,
        default_value TEXT,
        validation JSONB,
        sensitive BOOLEAN DEFAULT FALSE,
        encrypted BOOLEAN DEFAULT FALSE,
        expires_at TIMESTAMP,
        metadata JSONB DEFAULT '{}',
        version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(255),
        updated_by VARCHAR(255),
        UNIQUE(key, scope, scope_id)
      );

      CREATE INDEX IF NOT EXISTS idx_config_key ON ${this.tableName}(key);
      CREATE INDEX IF NOT EXISTS idx_config_scope ON ${this.tableName}(scope, scope_id);
      CREATE INDEX IF NOT EXISTS idx_config_expires ON ${this.tableName}(expires_at) WHERE expires_at IS NOT NULL;
    `;

    await this.database.execute(schema);
  }

  async get(key) {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE key = $1 
        AND scope = $2
        AND (scope_id = $3 OR (scope_id IS NULL AND $3 IS NULL))
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      ORDER BY scope_id DESC NULLS LAST
      LIMIT 1
    `;

    const result = await this.database.query(query, [key, this.scope, this.getScopeId()]);
    
    if (result.rows.length === 0) {
      return undefined;
    }

    const config = result.rows[0];
    let value = config.value;

    // Decrypt if needed
    if (config.encrypted && this.encryptionKey) {
      value = await this.decrypt(value);
    }

    // Transform based on type
    return this.transformFromStorage(value, config.type);
  }

  async set(key, value, options = {}) {
    const {
      type = this.detectType(value),
      description = null,
      defaultValue = null,
      validation = null,
      sensitive = false,
      encrypted = sensitive,
      expiresAt = null,
      metadata = {},
      userId = null
    } = options;

    let storedValue = this.transformForStorage(value);

    // Encrypt if needed
    if (encrypted && this.encryptionKey) {
      storedValue = await this.encrypt(storedValue);
    }

    const query = `
      INSERT INTO ${this.tableName} (
        key, value, type, scope, scope_id, description, 
        default_value, validation, sensitive, encrypted, 
        expires_at, metadata, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
      ON CONFLICT (key, scope, scope_id) DO UPDATE SET
        value = $2,
        type = $3,
        description = COALESCE($6, ${this.tableName}.description),
        default_value = COALESCE($7, ${this.tableName}.default_value),
        validation = COALESCE($8, ${this.tableName}.validation),
        sensitive = $9,
        encrypted = $10,
        expires_at = $11,
        metadata = ${this.tableName}.metadata || $12,
        version = ${this.tableName}.version + 1,
        updated_at = CURRENT_TIMESTAMP,
        updated_by = $13
      RETURNING *
    `;

    const params = [
      key,
      storedValue,
      type,
      this.scope,
      this.getScopeId(),
      description,
      defaultValue ? this.transformForStorage(defaultValue) : null,
      validation ? JSON.stringify(validation) : null,
      sensitive,
      encrypted,
      expiresAt,
      JSON.stringify(metadata),
      userId
    ];

    const result = await this.database.query(query, params);
    
    // Clear cache
    this.cache.delete(key);
    
    return result.rows[0];
  }

  async delete(key) {
    const query = `
      DELETE FROM ${this.tableName}
      WHERE key = $1 
        AND scope = $2
        AND (scope_id = $3 OR (scope_id IS NULL AND $3 IS NULL))
    `;

    await this.database.query(query, [key, this.scope, this.getScopeId()]);
    
    // Clear cache
    this.cache.delete(key);
  }

  async list(prefix) {
    let query = `
      SELECT DISTINCT key FROM ${this.tableName}
      WHERE scope = $1
        AND (scope_id = $2 OR (scope_id IS NULL AND $2 IS NULL))
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `;
    const params = [this.scope, this.getScopeId()];

    if (prefix) {
      query += ` AND key LIKE $3`;
      params.push(`${prefix}%`);
    }

    query += ` ORDER BY key`;

    const result = await this.database.query(query, params);
    return result.rows.map(row => row.key);
  }

  async getMany(keys) {
    const placeholders = keys.map((_, index) => `$${index + 3}`).join(', ');
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE key IN (${placeholders})
        AND scope = $1
        AND (scope_id = $2 OR (scope_id IS NULL AND $2 IS NULL))
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `;

    const result = await this.database.query(query, [this.scope, this.getScopeId(), ...keys]);
    
    const configs = {};
    for (const row of result.rows) {
      let value = row.value;
      
      if (row.encrypted && this.encryptionKey) {
        value = await this.decrypt(value);
      }
      
      configs[row.key] = this.transformFromStorage(value, row.type);
    }
    
    return configs;
  }

  async getAllWithMetadata(prefix) {
    let query = `
      SELECT * FROM ${this.tableName}
      WHERE scope = $1
        AND (scope_id = $2 OR (scope_id IS NULL AND $2 IS NULL))
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `;
    const params = [this.scope, this.getScopeId()];

    if (prefix) {
      query += ` AND key LIKE $3`;
      params.push(`${prefix}%`);
    }

    query += ` ORDER BY key`;

    const result = await this.database.query(query, params);
    
    const configs = [];
    for (const row of result.rows) {
      let value = row.value;
      
      if (row.encrypted && this.encryptionKey) {
        value = await this.decrypt(value);
      }
      
      configs.push({
        ...row,
        value: this.transformFromStorage(value, row.type)
      });
    }
    
    return configs;
  }

  async getHistory(key, limit = 10) {
    // This would require an audit table to track changes
    const query = `
      SELECT * FROM ${this.tableName}_history
      WHERE key = $1 
        AND scope = $2
        AND (scope_id = $3 OR (scope_id IS NULL AND $3 IS NULL))
      ORDER BY version DESC
      LIMIT $4
    `;

    try {
      const result = await this.database.query(query, [key, this.scope, this.getScopeId(), limit]);
      return result.rows;
    } catch (error) {
      // History table might not exist
      return [];
    }
  }

  async cleanup() {
    // Remove expired configurations
    const query = `
      DELETE FROM ${this.tableName}
      WHERE expires_at < CURRENT_TIMESTAMP
      RETURNING COUNT(*) as deleted
    `;

    const result = await this.database.query(query);
    return result.rows[0].deleted;
  }

  getScopeId() {
    switch (this.scope) {
      case ConfigurationScope.TENANT:
        return this.tenantId || this.config.scopeId;
      case ConfigurationScope.USER:
        return this.config.userId || this.config.scopeId;
      case ConfigurationScope.SERVICE:
        return this.config.serviceId || this.config.scopeId;
      default:
        return null;
    }
  }

  detectType(value) {
    if (value === null || value === undefined) {
      return 'string';
    }
    
    const type = typeof value;
    
    if (type === 'object') {
      if (Array.isArray(value)) {
        return 'array';
      }
      return 'object';
    }
    
    if (type === 'boolean') {
      return 'boolean';
    }
    
    if (type === 'number') {
      return 'number';
    }
    
    return 'string';
  }

  async encrypt(value) {
    // Simple example - in production use proper encryption
    if (!this.encryptionKey) {
      return value;
    }
    
    const crypto = require('crypto');
    const algorithm = 'aes-256-gcm';
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(this.encryptionKey, 'hex'), iv);
    
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  async decrypt(encryptedValue) {
    if (!this.encryptionKey) {
      return encryptedValue;
    }
    
    const crypto = require('crypto');
    const parts = encryptedValue.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const algorithm = 'aes-256-gcm';
    const decipher = crypto.createDecipheriv(algorithm, Buffer.from(this.encryptionKey, 'hex'), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  async getMetrics() {
    const base = await super.getMetrics();
    
    const countQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN sensitive = true THEN 1 END) as sensitive,
        COUNT(CASE WHEN encrypted = true THEN 1 END) as encrypted,
        COUNT(CASE WHEN expires_at IS NOT NULL THEN 1 END) as expiring
      FROM ${this.tableName}
      WHERE scope = $1
        AND (scope_id = $2 OR (scope_id IS NULL AND $2 IS NULL))
    `;
    
    const result = await this.database.query(countQuery, [this.scope, this.getScopeId()]);
    
    return {
      ...base,
      tableName: this.tableName,
      scope: this.scope,
      scopeId: this.getScopeId(),
      stats: result.rows[0]
    };
  }
}

module.exports = DatabaseProvider;