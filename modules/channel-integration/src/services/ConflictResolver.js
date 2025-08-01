class ConflictResolver {
  constructor(options) {
    this.strategy = options.strategy || 'latest-wins';
    this.database = options.database;
    this.customResolvers = new Map();
    
    this._registerDefaultResolvers();
  }

  async resolve(localItem, remoteItem, context) {
    const resolver = this.customResolvers.get(context.resource) || 
                    this._getDefaultResolver();
    
    const resolution = await resolver(localItem, remoteItem, context);
    
    await this._logConflictResolution(
      localItem,
      remoteItem,
      resolution,
      context
    );
    
    return resolution;
  }

  registerResolver(resource, resolver) {
    this.customResolvers.set(resource, resolver);
  }

  _registerDefaultResolvers() {
    this.registerResolver('inventory', async (local, remote, context) => {
      if (this.strategy === 'conservative') {
        const localQuantity = parseInt(local.quantity || 0);
        const remoteQuantity = parseInt(remote.quantity || 0);
        
        return {
          action: 'update',
          data: {
            ...remote,
            quantity: Math.min(localQuantity, remoteQuantity)
          },
          reason: 'Using lower quantity to prevent overselling'
        };
      }
      
      return this._getDefaultResolver()(local, remote, context);
    });

    this.registerResolver('orders', async (local, remote, context) => {
      const statusPriority = {
        'cancelled': 0,
        'refunded': 1,
        'completed': 2,
        'shipped': 3,
        'processing': 4,
        'pending': 5
      };
      
      const localPriority = statusPriority[local.status] || 999;
      const remotePriority = statusPriority[remote.status] || 999;
      
      if (localPriority < remotePriority) {
        return {
          action: 'skip',
          reason: `Local status (${local.status}) has higher priority than remote (${remote.status})`
        };
      }
      
      return this._getDefaultResolver()(local, remote, context);
    });

    this.registerResolver('products', async (local, remote, context) => {
      if (this.strategy === 'merge') {
        const merged = this._deepMerge(local, remote);
        
        if (local.images && remote.images) {
          merged.images = this._mergeArrays(local.images, remote.images, 'url');
        }
        
        if (local.variants && remote.variants) {
          merged.variants = this._mergeArrays(local.variants, remote.variants, 'sku');
        }
        
        return {
          action: 'update',
          data: merged,
          reason: 'Merged local and remote data'
        };
      }
      
      return this._getDefaultResolver()(local, remote, context);
    });
  }

  _getDefaultResolver() {
    const strategies = {
      'latest-wins': (local, remote) => {
        const localTime = new Date(local.updated_at || 0).getTime();
        const remoteTime = new Date(remote.updated_at || 0).getTime();
        
        if (remoteTime > localTime) {
          return {
            action: 'update',
            data: remote,
            reason: 'Remote item is newer'
          };
        } else {
          return {
            action: 'skip',
            reason: 'Local item is newer'
          };
        }
      },
      
      'local-wins': (local, remote) => ({
        action: 'skip',
        reason: 'Local data takes precedence'
      }),
      
      'remote-wins': (local, remote) => ({
        action: 'update',
        data: remote,
        reason: 'Remote data takes precedence'
      }),
      
      'manual': (local, remote, context) => ({
        action: 'queue',
        reason: 'Requires manual review',
        data: {
          local,
          remote,
          context
        }
      }),
      
      'merge': (local, remote) => ({
        action: 'update',
        data: this._deepMerge(local, remote),
        reason: 'Merged local and remote data'
      })
    };
    
    return strategies[this.strategy] || strategies['latest-wins'];
  }

  _deepMerge(obj1, obj2) {
    const result = { ...obj1 };
    
    for (const [key, value] of Object.entries(obj2)) {
      if (value === null || value === undefined) {
        continue;
      }
      
      if (typeof value === 'object' && !Array.isArray(value) && 
          obj1[key] && typeof obj1[key] === 'object' && !Array.isArray(obj1[key])) {
        result[key] = this._deepMerge(obj1[key], value);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  _mergeArrays(arr1, arr2, uniqueKey) {
    if (!uniqueKey) {
      return [...new Set([...arr1, ...arr2])];
    }
    
    const map = new Map();
    
    for (const item of arr1) {
      if (item[uniqueKey]) {
        map.set(item[uniqueKey], item);
      }
    }
    
    for (const item of arr2) {
      if (item[uniqueKey]) {
        const existing = map.get(item[uniqueKey]);
        if (existing) {
          map.set(item[uniqueKey], this._deepMerge(existing, item));
        } else {
          map.set(item[uniqueKey], item);
        }
      }
    }
    
    return Array.from(map.values());
  }

  async _logConflictResolution(localItem, remoteItem, resolution, context) {
    await this.database.insert('channel_conflict_logs', {
      channel_id: context.channel,
      resource: context.resource,
      local_id: localItem.id,
      remote_id: remoteItem.id,
      strategy: this.strategy,
      resolution_action: resolution.action,
      resolution_reason: resolution.reason,
      local_data: JSON.stringify(localItem),
      remote_data: JSON.stringify(remoteItem),
      resolved_data: resolution.data ? JSON.stringify(resolution.data) : null,
      created_at: new Date()
    });
  }

  async getConflictHistory(channelId, options = {}) {
    const { resource, limit = 100, offset = 0 } = options;
    
    let query = `
      SELECT * FROM channel_conflict_logs 
      WHERE channel_id = $1
    `;
    const params = [channelId];
    
    if (resource) {
      query += ` AND resource = $${params.length + 1}`;
      params.push(resource);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    return await this.database.query(query, params);
  }

  async getConflictStats(channelId, period = '30d') {
    const since = this._calculateSinceDate(period);
    
    const stats = await this.database.query(`
      SELECT 
        resource,
        resolution_action,
        COUNT(*) as count
      FROM channel_conflict_logs
      WHERE channel_id = $1 AND created_at >= $2
      GROUP BY resource, resolution_action
    `, [channelId, since]);
    
    const result = {};
    
    for (const row of stats) {
      if (!result[row.resource]) {
        result[row.resource] = {
          total: 0,
          updated: 0,
          skipped: 0,
          queued: 0
        };
      }
      
      result[row.resource].total += parseInt(row.count);
      result[row.resource][row.resolution_action] = parseInt(row.count);
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

module.exports = ConflictResolver;