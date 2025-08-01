const BaseChannel = require('./BaseChannel');
const { NotificationChannel, NotificationStatus } = require('../types');

class InAppChannel extends BaseChannel {
  constructor(config, dependencies = {}) {
    super(config);
    this.database = dependencies.database;
    this.eventBus = dependencies.eventBus;
    this.websocket = dependencies.websocket;
  }

  async initialize() {
    if (!this.enabled) {
      return;
    }

    // Ensure in-app notifications table exists
    if (this.database) {
      await this.ensureSchema();
    }
  }

  async ensureSchema() {
    const schema = `
      CREATE TABLE IF NOT EXISTS in_app_notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        notification_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        title VARCHAR(500) NOT NULL,
        body TEXT NOT NULL,
        category VARCHAR(50),
        priority VARCHAR(20) DEFAULT 'normal',
        data JSONB DEFAULT '{}',
        read_at TIMESTAMP,
        dismissed_at TIMESTAMP,
        action_taken VARCHAR(100),
        action_taken_at TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_notifications (user_id, created_at DESC),
        INDEX idx_unread_notifications (user_id, read_at) WHERE read_at IS NULL
      )
    `;

    await this.database.execute(schema);
  }

  validateRecipient(recipient) {
    return recipient.userId || recipient.id;
  }

  async send(notification, recipient) {
    if (!this.validateRecipient(recipient)) {
      throw new Error('Invalid in-app notification recipient');
    }

    const userId = recipient.userId || recipient.id;
    const options = this.getOptions(notification.options?.inApp);

    try {
      // Store notification in database
      const storedNotification = await this.storeNotification({
        notificationId: notification.id,
        userId,
        title: notification.subject,
        body: notification.body,
        category: notification.category,
        priority: notification.priority,
        data: notification.data || {},
        expiresAt: options.expiresAt
      });

      // Send real-time notification if user is online
      if (this.websocket && options.realtime !== false) {
        await this.sendRealTimeNotification(userId, storedNotification);
      }

      // Emit event for other systems to react
      if (this.eventBus) {
        await this.eventBus.emit('notification.inapp.sent', {
          notificationId: storedNotification.id,
          userId,
          category: notification.category
        });
      }

      return this.formatDelivery({
        notificationId: notification.id,
        recipientId: recipient.id,
        channel: NotificationChannel.IN_APP,
        status: NotificationStatus.DELIVERED,
        providerResponse: {
          id: storedNotification.id,
          stored: true,
          realtime: storedNotification.realtime
        },
        metadata: {
          userId,
          expiresAt: storedNotification.expiresAt
        }
      });
    } catch (error) {
      return this.formatDelivery({
        notificationId: notification.id,
        recipientId: recipient.id,
        channel: NotificationChannel.IN_APP,
        status: NotificationStatus.FAILED,
        error: this.handleError(error)
      });
    }
  }

  async storeNotification(data) {
    const query = `
      INSERT INTO in_app_notifications (
        notification_id, user_id, title, body, category, 
        priority, data, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const params = [
      data.notificationId,
      data.userId,
      data.title,
      data.body,
      data.category,
      data.priority,
      JSON.stringify(data.data),
      data.expiresAt
    ];

    const result = await this.database.query(query, params);
    return result.rows[0];
  }

  async sendRealTimeNotification(userId, notification) {
    if (!this.websocket) {
      return { realtime: false };
    }

    try {
      // Check if user has active websocket connection
      const isOnline = await this.websocket.isUserOnline(userId);
      
      if (isOnline) {
        // Send notification through websocket
        await this.websocket.sendToUser(userId, {
          type: 'notification',
          data: {
            id: notification.id,
            title: notification.title,
            body: notification.body,
            category: notification.category,
            priority: notification.priority,
            data: notification.data,
            createdAt: notification.created_at
          }
        });

        return { realtime: true, delivered: true };
      }

      return { realtime: true, delivered: false, reason: 'user_offline' };
    } catch (error) {
      console.error('Failed to send real-time notification:', error);
      return { realtime: true, delivered: false, error: error.message };
    }
  }

  // Additional methods for managing in-app notifications

  async markAsRead(userId, notificationId) {
    const query = `
      UPDATE in_app_notifications 
      SET read_at = CURRENT_TIMESTAMP 
      WHERE user_id = $1 AND id = $2 AND read_at IS NULL
      RETURNING *
    `;

    const result = await this.database.query(query, [userId, notificationId]);
    
    if (result.rows[0] && this.eventBus) {
      await this.eventBus.emit('notification.inapp.read', {
        notificationId,
        userId,
        readAt: result.rows[0].read_at
      });
    }

    return result.rows[0];
  }

  async markAllAsRead(userId, category = null) {
    let query = `
      UPDATE in_app_notifications 
      SET read_at = CURRENT_TIMESTAMP 
      WHERE user_id = $1 AND read_at IS NULL
    `;
    const params = [userId];

    if (category) {
      query += ' AND category = $2';
      params.push(category);
    }

    const result = await this.database.query(query, params);
    return result.rowCount;
  }

  async dismiss(userId, notificationId) {
    const query = `
      UPDATE in_app_notifications 
      SET dismissed_at = CURRENT_TIMESTAMP 
      WHERE user_id = $1 AND id = $2
      RETURNING *
    `;

    const result = await this.database.query(query, [userId, notificationId]);
    return result.rows[0];
  }

  async recordAction(userId, notificationId, action) {
    const query = `
      UPDATE in_app_notifications 
      SET action_taken = $3, action_taken_at = CURRENT_TIMESTAMP 
      WHERE user_id = $1 AND id = $2
      RETURNING *
    `;

    const result = await this.database.query(query, [userId, notificationId, action]);
    
    if (result.rows[0] && this.eventBus) {
      await this.eventBus.emit('notification.inapp.action', {
        notificationId,
        userId,
        action,
        actionAt: result.rows[0].action_taken_at
      });
    }

    return result.rows[0];
  }

  async getUserNotifications(userId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      category = null,
      unreadOnly = false,
      includeExpired = false
    } = options;

    let query = `
      SELECT * FROM in_app_notifications 
      WHERE user_id = $1
    `;
    const params = [userId];
    let paramIndex = 2;

    if (category) {
      query += ` AND category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (unreadOnly) {
      query += ' AND read_at IS NULL';
    }

    if (!includeExpired) {
      query += ' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)';
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await this.database.query(query, params);
    return result.rows;
  }

  async getUnreadCount(userId, category = null) {
    let query = `
      SELECT COUNT(*) as count 
      FROM in_app_notifications 
      WHERE user_id = $1 AND read_at IS NULL 
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `;
    const params = [userId];

    if (category) {
      query += ' AND category = $2';
      params.push(category);
    }

    const result = await this.database.query(query, params);
    return parseInt(result.rows[0].count);
  }

  async cleanupExpired() {
    const query = `
      DELETE FROM in_app_notifications 
      WHERE expires_at < CURRENT_TIMESTAMP
      RETURNING COUNT(*) as deleted
    `;

    const result = await this.database.query(query);
    return result.rows[0].deleted;
  }

  async isAvailable() {
    return this.enabled && this.database !== null;
  }

  async getMetrics() {
    const base = await super.getMetrics();
    
    return {
      ...base,
      features: {
        persistence: true,
        realtime: this.websocket !== null,
        events: this.eventBus !== null,
        expiration: true,
        actions: true
      }
    };
  }
}

module.exports = InAppChannel;