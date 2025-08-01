class SyncOrchestrator {
  constructor(options) {
    this.database = options.database;
    this.queue = options.queue;
    this.eventBus = options.eventBus;
    this.syncInterval = options.syncInterval;
  }

  async executeSync(channel, options, services) {
    const syncId = this._generateSyncId();
    const startTime = Date.now();
    
    const syncLog = {
      id: syncId,
      channelId: channel.id,
      type: options.fullSync ? 'full' : 'incremental',
      direction: options.direction,
      status: 'running',
      startedAt: new Date(),
      resources: options.resources,
      stats: {
        processed: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        conflicts: 0,
        errors: 0
      }
    };

    await this._saveSyncLog(syncLog);

    try {
      const results = {};
      
      for (const resource of options.resources) {
        results[resource] = await this._syncResource(
          channel,
          resource,
          options,
          services,
          syncLog
        );
      }

      syncLog.status = 'completed';
      syncLog.completedAt = new Date();
      syncLog.duration = Date.now() - startTime;
      syncLog.results = results;

      await this._saveSyncLog(syncLog);
      
      this.eventBus.emit('sync:completed', {
        channelId: channel.id,
        syncId,
        stats: syncLog.stats
      });

      return {
        syncId,
        stats: syncLog.stats,
        results
      };
    } catch (error) {
      syncLog.status = 'failed';
      syncLog.completedAt = new Date();
      syncLog.duration = Date.now() - startTime;
      syncLog.error = error.message;

      await this._saveSyncLog(syncLog);
      
      this.eventBus.emit('sync:failed', {
        channelId: channel.id,
        syncId,
        error: error.message
      });

      throw error;
    }
  }

  async _syncResource(channel, resource, options, services, syncLog) {
    const { conflictResolver, rateLimiter, transformer } = services;
    
    const result = {
      resource,
      processed: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      conflicts: 0,
      errors: []
    };

    try {
      if (options.direction === 'inbound' || options.direction === 'bidirectional') {
        await this._syncInbound(
          channel,
          resource,
          options,
          services,
          result
        );
      }

      if (options.direction === 'outbound' || options.direction === 'bidirectional') {
        await this._syncOutbound(
          channel,
          resource,
          options,
          services,
          result
        );
      }

      syncLog.stats.processed += result.processed;
      syncLog.stats.created += result.created;
      syncLog.stats.updated += result.updated;
      syncLog.stats.deleted += result.deleted;
      syncLog.stats.conflicts += result.conflicts;
      syncLog.stats.errors += result.errors.length;

      return result;
    } catch (error) {
      result.errors.push({
        message: error.message,
        timestamp: new Date()
      });
      throw error;
    }
  }

  async _syncInbound(channel, resource, options, services, result) {
    const { conflictResolver, rateLimiter, transformer } = services;
    
    let page = 1;
    let hasMore = true;
    const batchSize = 100;

    while (hasMore) {
      await rateLimiter.checkLimit(channel.id, `${resource}:read`);
      
      const batch = await channel.adapter.fetchResources(resource, {
        page,
        limit: batchSize,
        since: options.fullSync ? null : channel.lastSync
      });

      if (!batch || batch.length === 0) {
        hasMore = false;
        continue;
      }

      for (const remoteItem of batch) {
        try {
          result.processed++;
          
          const transformedItem = transformer.transform(
            remoteItem,
            'inbound'
          );

          const localItem = await this._findLocalItem(
            resource,
            transformedItem,
            channel.id
          );

          if (!localItem) {
            await this._createLocalItem(
              resource,
              transformedItem,
              channel.id
            );
            result.created++;
          } else {
            const hasConflict = await this._detectConflict(
              localItem,
              transformedItem
            );

            if (hasConflict) {
              const resolution = await conflictResolver.resolve(
                localItem,
                transformedItem,
                { resource, channel: channel.id }
              );

              if (resolution.action === 'update') {
                await this._updateLocalItem(
                  resource,
                  localItem.id,
                  resolution.data,
                  channel.id
                );
                result.updated++;
              } else if (resolution.action === 'skip') {
                result.conflicts++;
              }
            } else if (this._hasChanges(localItem, transformedItem)) {
              await this._updateLocalItem(
                resource,
                localItem.id,
                transformedItem,
                channel.id
              );
              result.updated++;
            }
          }

          await this._updateSyncStatus(
            resource,
            localItem?.id || transformedItem.id,
            channel.id,
            {
              lastSyncedAt: new Date(),
              remoteId: remoteItem.id,
              remoteVersion: remoteItem.version || remoteItem.updated_at
            }
          );
        } catch (error) {
          result.errors.push({
            resource,
            itemId: remoteItem.id,
            error: error.message,
            timestamp: new Date()
          });
        }
      }

      page++;
      hasMore = batch.length === batchSize;
    }
  }

  async _syncOutbound(channel, resource, options, services, result) {
    const { rateLimiter, transformer } = services;
    
    const localItems = await this._getLocalItemsForSync(
      resource,
      channel.id,
      options.fullSync ? null : channel.lastSync
    );

    for (const localItem of localItems) {
      try {
        result.processed++;
        
        await rateLimiter.checkLimit(channel.id, `${resource}:write`);
        
        const transformedItem = transformer.transform(
          localItem,
          'outbound'
        );

        const syncStatus = await this._getSyncStatus(
          resource,
          localItem.id,
          channel.id
        );

        if (!syncStatus?.remoteId) {
          const remoteItem = await channel.adapter.createResource(
            resource,
            transformedItem
          );
          
          await this._updateSyncStatus(
            resource,
            localItem.id,
            channel.id,
            {
              remoteId: remoteItem.id,
              lastSyncedAt: new Date(),
              remoteVersion: remoteItem.version || remoteItem.updated_at
            }
          );
          
          result.created++;
        } else {
          const remoteItem = await channel.adapter.updateResource(
            resource,
            syncStatus.remoteId,
            transformedItem
          );
          
          await this._updateSyncStatus(
            resource,
            localItem.id,
            channel.id,
            {
              lastSyncedAt: new Date(),
              remoteVersion: remoteItem.version || remoteItem.updated_at
            }
          );
          
          result.updated++;
        }
      } catch (error) {
        result.errors.push({
          resource,
          itemId: localItem.id,
          error: error.message,
          timestamp: new Date()
        });
      }
    }
  }

  async _findLocalItem(resource, item, channelId) {
    const table = this._getResourceTable(resource);
    
    const syncStatus = await this.database.queryOne(
      `SELECT local_id FROM channel_sync_status 
       WHERE channel_id = $1 AND resource = $2 AND remote_id = $3`,
      [channelId, resource, item.id]
    );

    if (syncStatus) {
      return await this.database.queryOne(
        `SELECT * FROM ${table} WHERE id = $1`,
        [syncStatus.local_id]
      );
    }

    if (item.sku && resource === 'products') {
      return await this.database.queryOne(
        `SELECT * FROM products WHERE sku = $1`,
        [item.sku]
      );
    }

    if (item.external_id) {
      return await this.database.queryOne(
        `SELECT * FROM ${table} WHERE external_id = $1`,
        [item.external_id]
      );
    }

    return null;
  }

  async _createLocalItem(resource, item, channelId) {
    const table = this._getResourceTable(resource);
    const now = new Date();
    
    const localItem = await this.database.insert(table, {
      ...item,
      created_at: now,
      updated_at: now,
      created_by: 'channel_sync',
      channel_id: channelId
    });

    this.eventBus.emit(`${resource}:created`, {
      id: localItem.id,
      source: 'channel_sync',
      channelId
    });

    return localItem;
  }

  async _updateLocalItem(resource, id, data, channelId) {
    const table = this._getResourceTable(resource);
    
    const updatedItem = await this.database.update(
      table,
      { ...data, updated_at: new Date() },
      { id }
    );

    this.eventBus.emit(`${resource}:updated`, {
      id,
      changes: data,
      source: 'channel_sync',
      channelId
    });

    return updatedItem;
  }

  async _getLocalItemsForSync(resource, channelId, since) {
    const table = this._getResourceTable(resource);
    
    if (since) {
      return await this.database.query(
        `SELECT * FROM ${table} 
         WHERE updated_at > $1 
         AND (channel_id IS NULL OR channel_id = $2)
         ORDER BY updated_at ASC`,
        [since, channelId]
      );
    }

    return await this.database.query(
      `SELECT * FROM ${table} 
       WHERE channel_id IS NULL OR channel_id = $1
       ORDER BY updated_at ASC`,
      [channelId]
    );
  }

  async _getSyncStatus(resource, localId, channelId) {
    return await this.database.queryOne(
      `SELECT * FROM channel_sync_status 
       WHERE channel_id = $1 AND resource = $2 AND local_id = $3`,
      [channelId, resource, localId]
    );
  }

  async _updateSyncStatus(resource, localId, channelId, data) {
    await this.database.upsert(
      'channel_sync_status',
      {
        channel_id: channelId,
        resource,
        local_id: localId,
        ...data,
        updated_at: new Date()
      },
      ['channel_id', 'resource', 'local_id']
    );
  }

  async _detectConflict(localItem, remoteItem) {
    if (!localItem.updated_at || !remoteItem.updated_at) {
      return false;
    }

    const localTime = new Date(localItem.updated_at).getTime();
    const remoteTime = new Date(remoteItem.updated_at).getTime();
    
    return Math.abs(localTime - remoteTime) > 1000;
  }

  _hasChanges(localItem, remoteItem) {
    const ignoreFields = ['id', 'created_at', 'updated_at', 'channel_id'];
    
    for (const key of Object.keys(remoteItem)) {
      if (ignoreFields.includes(key)) continue;
      
      if (JSON.stringify(localItem[key]) !== JSON.stringify(remoteItem[key])) {
        return true;
      }
    }
    
    return false;
  }

  _getResourceTable(resource) {
    const mapping = {
      products: 'products',
      inventory: 'inventory',
      orders: 'orders',
      customers: 'customers',
      categories: 'categories'
    };
    
    return mapping[resource] || resource;
  }

  async _saveSyncLog(syncLog) {
    await this.database.upsert(
      'channel_sync_logs',
      {
        ...syncLog,
        stats: JSON.stringify(syncLog.stats),
        results: JSON.stringify(syncLog.results)
      },
      ['id']
    );
  }

  _generateSyncId() {
    return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = SyncOrchestrator;