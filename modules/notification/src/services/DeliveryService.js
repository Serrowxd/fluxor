const Bull = require('bull');
const { NotificationStatus, NotificationPriority } = require('../types');

class DeliveryService {
  constructor(config = {}, dependencies = {}) {
    this.config = config;
    this.database = dependencies.database;
    this.eventBus = dependencies.eventBus;
    this.channels = new Map();
    this.queue = null;
    this.retryConfig = {
      attempts: config.retry?.attempts || 3,
      backoff: {
        type: config.retry?.backoff?.type || 'exponential',
        delay: config.retry?.backoff?.delay || 5000
      }
    };
  }

  async initialize() {
    // Initialize delivery queue
    if (this.config.queue?.enabled !== false) {
      this.queue = new Bull('notification-delivery', {
        redis: this.config.redis || this.config.queue?.redis,
        defaultJobOptions: {
          attempts: this.retryConfig.attempts,
          backoff: this.retryConfig.backoff,
          removeOnComplete: true,
          removeOnFail: false
        }
      });

      // Process delivery jobs
      this.queue.process('deliver', this.config.queue?.concurrency || 10, 
        this.processDelivery.bind(this));

      // Handle failed jobs
      this.queue.on('failed', this.handleFailedJob.bind(this));
    }

    // Ensure delivery tracking schema
    if (this.database) {
      await this.ensureSchema();
    }
  }

  async ensureSchema() {
    const schema = `
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        notification_id VARCHAR(255) NOT NULL,
        recipient_id VARCHAR(255) NOT NULL,
        channel VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL,
        attempts INTEGER DEFAULT 1,
        sent_at TIMESTAMP,
        delivered_at TIMESTAMP,
        opened_at TIMESTAMP,
        clicked_at TIMESTAMP,
        failed_at TIMESTAMP,
        error JSONB,
        provider_response JSONB,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_notification_deliveries (notification_id),
        INDEX idx_recipient_deliveries (recipient_id, created_at DESC),
        INDEX idx_delivery_status (status, created_at)
      )
    `;

    await this.database.execute(schema);
  }

  registerChannel(name, channel) {
    this.channels.set(name, channel);
  }

  async deliver(notification, recipients, options = {}) {
    const deliveries = [];

    // Determine delivery strategy
    if (options.immediate || notification.priority === NotificationPriority.URGENT) {
      // Immediate delivery
      for (const recipient of recipients) {
        const delivery = await this.deliverToRecipient(notification, recipient);
        deliveries.push(delivery);
      }
    } else {
      // Queue for async delivery
      for (const recipient of recipients) {
        const job = await this.queueDelivery(notification, recipient, options);
        deliveries.push({
          notificationId: notification.id,
          recipientId: recipient.id,
          status: NotificationStatus.PENDING,
          jobId: job.id
        });
      }
    }

    // Emit event
    if (this.eventBus) {
      await this.eventBus.emit('notification.delivery.initiated', {
        notificationId: notification.id,
        recipientCount: recipients.length,
        deliveries
      });
    }

    return deliveries;
  }

  async deliverToRecipient(notification, recipient) {
    const channel = this.channels.get(notification.channel);
    
    if (!channel) {
      throw new Error(`Channel not found: ${notification.channel}`);
    }

    // Validate recipient for channel
    if (!channel.validateRecipient(recipient)) {
      return this.recordDelivery({
        notificationId: notification.id,
        recipientId: recipient.id,
        channel: notification.channel,
        status: NotificationStatus.FAILED,
        error: {
          code: 'INVALID_RECIPIENT',
          message: `Recipient invalid for channel ${notification.channel}`
        }
      });
    }

    // Check if channel is available
    const isAvailable = await channel.isAvailable();
    if (!isAvailable) {
      return this.recordDelivery({
        notificationId: notification.id,
        recipientId: recipient.id,
        channel: notification.channel,
        status: NotificationStatus.FAILED,
        error: {
          code: 'CHANNEL_UNAVAILABLE',
          message: `Channel ${notification.channel} is not available`
        }
      });
    }

    // Send through channel
    try {
      const delivery = await channel.send(notification, recipient);
      
      // Record delivery
      await this.recordDelivery(delivery);
      
      // Emit success event
      if (this.eventBus && delivery.status === NotificationStatus.SENT) {
        await this.eventBus.emit('notification.delivery.sent', {
          notificationId: notification.id,
          recipientId: recipient.id,
          channel: notification.channel,
          deliveryId: delivery.id
        });
      }
      
      return delivery;
    } catch (error) {
      console.error('Delivery error:', error);
      
      const failedDelivery = {
        notificationId: notification.id,
        recipientId: recipient.id,
        channel: notification.channel,
        status: NotificationStatus.FAILED,
        error: {
          code: error.code || 'DELIVERY_ERROR',
          message: error.message,
          details: error
        }
      };
      
      await this.recordDelivery(failedDelivery);
      
      // Emit failure event
      if (this.eventBus) {
        await this.eventBus.emit('notification.delivery.failed', failedDelivery);
      }
      
      return failedDelivery;
    }
  }

  async queueDelivery(notification, recipient, options = {}) {
    if (!this.queue) {
      throw new Error('Queue not initialized');
    }

    const jobData = {
      notification,
      recipient,
      options
    };

    const jobOptions = {
      priority: this.getPriorityValue(notification.priority),
      delay: options.delay || 0,
      attempts: options.attempts || this.retryConfig.attempts
    };

    if (notification.scheduledAt) {
      jobOptions.delay = new Date(notification.scheduledAt).getTime() - Date.now();
    }

    return await this.queue.add('deliver', jobData, jobOptions);
  }

  async processDelivery(job) {
    const { notification, recipient, options } = job.data;
    
    try {
      const delivery = await this.deliverToRecipient(notification, recipient);
      
      // Update job progress
      job.progress(100);
      
      return delivery;
    } catch (error) {
      // Log error and let Bull handle retry
      console.error('Job processing error:', error);
      throw error;
    }
  }

  async handleFailedJob(job, error) {
    const { notification, recipient } = job.data;
    
    console.error(`Delivery job failed after ${job.attemptsMade} attempts:`, error);
    
    // Record final failure
    if (job.attemptsMade >= this.retryConfig.attempts) {
      await this.recordDelivery({
        notificationId: notification.id,
        recipientId: recipient.id,
        channel: notification.channel,
        status: NotificationStatus.FAILED,
        attempts: job.attemptsMade,
        error: {
          code: 'MAX_RETRIES_EXCEEDED',
          message: `Failed after ${job.attemptsMade} attempts`,
          lastError: error.message
        }
      });
    }
  }

  async recordDelivery(delivery) {
    if (!this.database) {
      return delivery;
    }

    const query = `
      INSERT INTO notification_deliveries (
        notification_id, recipient_id, channel, status, attempts,
        sent_at, delivered_at, failed_at, error, provider_response, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (notification_id, recipient_id, channel) 
      DO UPDATE SET
        status = $4,
        attempts = notification_deliveries.attempts + 1,
        updated_at = CURRENT_TIMESTAMP,
        ${delivery.status === NotificationStatus.FAILED ? 'failed_at = $8,' : ''}
        error = $9,
        provider_response = $10,
        metadata = $11
      RETURNING *
    `;

    const params = [
      delivery.notificationId,
      delivery.recipientId,
      delivery.channel,
      delivery.status,
      delivery.attempts || 1,
      delivery.sentAt || new Date(),
      delivery.deliveredAt,
      delivery.status === NotificationStatus.FAILED ? new Date() : null,
      JSON.stringify(delivery.error || null),
      JSON.stringify(delivery.providerResponse || null),
      JSON.stringify(delivery.metadata || {})
    ];

    const result = await this.database.query(query, params);
    return result.rows[0];
  }

  async updateDeliveryStatus(deliveryId, status, additionalData = {}) {
    if (!this.database) {
      return null;
    }

    const updates = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
    const params = [deliveryId, status];
    let paramIndex = 3;

    // Handle status-specific updates
    switch (status) {
      case NotificationStatus.DELIVERED:
        updates.push(`delivered_at = $${paramIndex}`);
        params.push(additionalData.deliveredAt || new Date());
        paramIndex++;
        break;
        
      case NotificationStatus.OPENED:
        updates.push(`opened_at = $${paramIndex}`);
        params.push(additionalData.openedAt || new Date());
        paramIndex++;
        break;
        
      case NotificationStatus.CLICKED:
        updates.push(`clicked_at = $${paramIndex}`);
        params.push(additionalData.clickedAt || new Date());
        paramIndex++;
        break;
    }

    if (additionalData.metadata) {
      updates.push(`metadata = metadata || $${paramIndex}`);
      params.push(JSON.stringify(additionalData.metadata));
    }

    const query = `
      UPDATE notification_deliveries 
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result = await this.database.query(query, params);
    const updated = result.rows[0];

    // Emit status update event
    if (updated && this.eventBus) {
      await this.eventBus.emit('notification.delivery.status_updated', {
        deliveryId,
        notificationId: updated.notification_id,
        recipientId: updated.recipient_id,
        oldStatus: updated.status,
        newStatus: status,
        ...additionalData
      });
    }

    return updated;
  }

  async getDeliveryStatus(notificationId, recipientId = null) {
    if (!this.database) {
      return null;
    }

    if (recipientId) {
      const query = `
        SELECT * FROM notification_deliveries 
        WHERE notification_id = $1 AND recipient_id = $2
        ORDER BY created_at DESC
      `;
      const result = await this.database.query(query, [notificationId, recipientId]);
      return result.rows;
    } else {
      const query = `
        SELECT 
          channel,
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent,
          COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
          COUNT(CASE WHEN status = 'opened' THEN 1 END) as opened,
          COUNT(CASE WHEN status = 'clicked' THEN 1 END) as clicked,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
        FROM notification_deliveries 
        WHERE notification_id = $1
        GROUP BY channel
      `;
      const result = await this.database.query(query, [notificationId]);
      return result.rows;
    }
  }

  getPriorityValue(priority) {
    const priorityMap = {
      [NotificationPriority.URGENT]: 1,
      [NotificationPriority.HIGH]: 2,
      [NotificationPriority.NORMAL]: 5,
      [NotificationPriority.LOW]: 10
    };
    return priorityMap[priority] || 5;
  }

  async getMetrics(timeRange = '1 hour') {
    if (!this.database) {
      return null;
    }

    const query = `
      SELECT 
        channel,
        status,
        COUNT(*) as count,
        AVG(EXTRACT(EPOCH FROM (delivered_at - sent_at))) as avg_delivery_time
      FROM notification_deliveries
      WHERE created_at > NOW() - INTERVAL '${timeRange}'
      GROUP BY channel, status
    `;

    const result = await this.database.query(query);
    
    // Format metrics
    const metrics = {};
    result.rows.forEach(row => {
      if (!metrics[row.channel]) {
        metrics[row.channel] = {
          total: 0,
          byStatus: {},
          avgDeliveryTime: null
        };
      }
      
      metrics[row.channel].total += parseInt(row.count);
      metrics[row.channel].byStatus[row.status] = parseInt(row.count);
      
      if (row.avg_delivery_time && row.status === NotificationStatus.DELIVERED) {
        metrics[row.channel].avgDeliveryTime = row.avg_delivery_time;
      }
    });

    return metrics;
  }

  async cleanup() {
    if (this.queue) {
      await this.queue.close();
    }
  }
}

module.exports = DeliveryService;