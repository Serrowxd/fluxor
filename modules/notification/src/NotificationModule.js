const EmailChannel = require('./channels/EmailChannel');
const SMSChannel = require('./channels/SMSChannel');
const PushChannel = require('./channels/PushChannel');
const InAppChannel = require('./channels/InAppChannel');
const TemplateService = require('./services/TemplateService');
const DeliveryService = require('./services/DeliveryService');
const { NotificationChannel } = require('./types');

class NotificationModule {
  constructor(config = {}) {
    this.config = config;
    this.initialized = false;
    this.templateService = null;
    this.deliveryService = null;
    this.channels = new Map();
    this.hooks = {
      beforeSend: [],
      afterSend: [],
      onError: []
    };
  }

  async initialize(dependencies = {}) {
    if (this.initialized) {
      return;
    }

    // Initialize template service
    this.templateService = new TemplateService({
      ...this.config.templates,
      database: dependencies.database
    });
    await this.templateService.initialize();

    // Initialize delivery service
    this.deliveryService = new DeliveryService(
      this.config.delivery || {},
      {
        database: dependencies.database,
        eventBus: dependencies.eventBus
      }
    );
    await this.deliveryService.initialize();

    // Initialize channels
    await this.initializeChannels(dependencies);

    this.initialized = true;
  }

  async initializeChannels(dependencies) {
    const channelConfigs = this.config.channels || {};

    // Email channel
    if (channelConfigs.email?.enabled !== false) {
      const emailChannel = new EmailChannel(channelConfigs.email || {});
      await emailChannel.initialize();
      this.registerChannel(NotificationChannel.EMAIL, emailChannel);
    }

    // SMS channel
    if (channelConfigs.sms?.enabled !== false) {
      const smsChannel = new SMSChannel(channelConfigs.sms || {});
      await smsChannel.initialize();
      this.registerChannel(NotificationChannel.SMS, smsChannel);
    }

    // Push channel
    if (channelConfigs.push?.enabled !== false) {
      const pushChannel = new PushChannel(channelConfigs.push || {});
      await pushChannel.initialize();
      this.registerChannel(NotificationChannel.PUSH, pushChannel);
    }

    // In-app channel
    if (channelConfigs.inApp?.enabled !== false) {
      const inAppChannel = new InAppChannel(
        channelConfigs.inApp || {},
        {
          database: dependencies.database,
          eventBus: dependencies.eventBus,
          websocket: dependencies.websocket
        }
      );
      await inAppChannel.initialize();
      this.registerChannel(NotificationChannel.IN_APP, inAppChannel);
    }
  }

  registerChannel(name, channel) {
    this.channels.set(name, channel);
    this.deliveryService.registerChannel(name, channel);
  }

  /**
   * Send notification using template
   * @param {Object} params
   * @param {string} params.templateId - Template to use
   * @param {Array} params.recipients - List of recipients
   * @param {Object} params.data - Template data
   * @param {Object} params.options - Additional options
   */
  async send({ templateId, recipients, data = {}, options = {} }) {
    if (!this.initialized) {
      throw new Error('NotificationModule not initialized');
    }

    // Render template
    const rendered = await this.templateService.renderTemplate(templateId, data);
    
    // Create notification object
    const notification = {
      id: options.id || this.generateNotificationId(),
      templateId,
      channel: options.channel || rendered.channel,
      subject: rendered.subject,
      body: rendered.body,
      plainText: options.plainText,
      category: options.category || rendered.metadata?.category,
      priority: options.priority || rendered.metadata?.priority || 'normal',
      data: data,
      options: options,
      metadata: {
        ...rendered.metadata,
        ...options.metadata
      },
      scheduledAt: options.scheduledAt
    };

    // Run before send hooks
    for (const hook of this.hooks.beforeSend) {
      await hook(notification, recipients);
    }

    try {
      // Validate recipients for channel
      const channel = this.channels.get(notification.channel);
      if (!channel) {
        throw new Error(`Channel not configured: ${notification.channel}`);
      }

      const validRecipients = recipients.filter(r => channel.validateRecipient(r));
      const invalidRecipients = recipients.filter(r => !channel.validateRecipient(r));

      if (invalidRecipients.length > 0) {
        console.warn(`${invalidRecipients.length} invalid recipients for channel ${notification.channel}`);
      }

      if (validRecipients.length === 0) {
        throw new Error('No valid recipients for notification');
      }

      // Send through delivery service
      const deliveries = await this.deliveryService.deliver(
        notification,
        validRecipients,
        options
      );

      // Run after send hooks
      for (const hook of this.hooks.afterSend) {
        await hook(notification, deliveries);
      }

      return {
        notificationId: notification.id,
        channel: notification.channel,
        totalRecipients: recipients.length,
        validRecipients: validRecipients.length,
        invalidRecipients: invalidRecipients.length,
        deliveries
      };
    } catch (error) {
      // Run error hooks
      for (const hook of this.hooks.onError) {
        await hook(error, notification, recipients);
      }
      throw error;
    }
  }

  /**
   * Send notification without template
   * @param {Object} params
   */
  async sendDirect({ channel, recipients, subject, body, options = {} }) {
    if (!this.initialized) {
      throw new Error('NotificationModule not initialized');
    }

    const notification = {
      id: options.id || this.generateNotificationId(),
      channel,
      subject,
      body,
      plainText: options.plainText,
      category: options.category,
      priority: options.priority || 'normal',
      data: options.data || {},
      options: options,
      metadata: options.metadata || {},
      scheduledAt: options.scheduledAt
    };

    // Run before send hooks
    for (const hook of this.hooks.beforeSend) {
      await hook(notification, recipients);
    }

    try {
      const deliveries = await this.deliveryService.deliver(
        notification,
        recipients,
        options
      );

      // Run after send hooks
      for (const hook of this.hooks.afterSend) {
        await hook(notification, deliveries);
      }

      return {
        notificationId: notification.id,
        channel: notification.channel,
        recipients: recipients.length,
        deliveries
      };
    } catch (error) {
      // Run error hooks
      for (const hook of this.hooks.onError) {
        await hook(error, notification, recipients);
      }
      throw error;
    }
  }

  /**
   * Send to specific user across all configured channels
   * @param {Object} params
   */
  async sendToUser({ userId, templateId, data = {}, channels = [], options = {} }) {
    const results = [];
    const availableChannels = channels.length > 0 ? channels : Array.from(this.channels.keys());

    for (const channelName of availableChannels) {
      try {
        // Build recipient object based on channel requirements
        const recipient = await this.buildRecipientForChannel(userId, channelName);
        
        if (recipient) {
          const result = await this.send({
            templateId,
            recipients: [recipient],
            data,
            options: {
              ...options,
              channel: channelName
            }
          });
          results.push(result);
        }
      } catch (error) {
        console.error(`Failed to send to user ${userId} via ${channelName}:`, error);
        results.push({
          channel: channelName,
          error: error.message
        });
      }
    }

    return results;
  }

  async buildRecipientForChannel(userId, channel) {
    // This would typically fetch user preferences and contact info from database
    // For now, returning a mock recipient
    return {
      id: userId,
      userId: userId,
      // These would be fetched from user profile
      email: channel === NotificationChannel.EMAIL ? `user${userId}@example.com` : undefined,
      phone: channel === NotificationChannel.SMS ? `+1234567890` : undefined,
      deviceToken: channel === NotificationChannel.PUSH ? `token_${userId}` : undefined
    };
  }

  // Template management methods
  async createTemplate(template) {
    return await this.templateService.createTemplate(template);
  }

  async updateTemplate(templateId, updates) {
    return await this.templateService.updateTemplate(templateId, updates);
  }

  async deleteTemplate(templateId) {
    return await this.templateService.deleteTemplate(templateId);
  }

  async getTemplate(templateId) {
    return await this.templateService.getTemplate(templateId);
  }

  // Delivery tracking methods
  async getDeliveryStatus(notificationId, recipientId = null) {
    return await this.deliveryService.getDeliveryStatus(notificationId, recipientId);
  }

  async updateDeliveryStatus(deliveryId, status, data = {}) {
    return await this.deliveryService.updateDeliveryStatus(deliveryId, status, data);
  }

  // In-app notification methods
  async getInAppNotifications(userId, options = {}) {
    const inAppChannel = this.channels.get(NotificationChannel.IN_APP);
    if (!inAppChannel) {
      throw new Error('In-app channel not configured');
    }
    return await inAppChannel.getUserNotifications(userId, options);
  }

  async markAsRead(userId, notificationId) {
    const inAppChannel = this.channels.get(NotificationChannel.IN_APP);
    if (!inAppChannel) {
      throw new Error('In-app channel not configured');
    }
    return await inAppChannel.markAsRead(userId, notificationId);
  }

  async markAllAsRead(userId, category = null) {
    const inAppChannel = this.channels.get(NotificationChannel.IN_APP);
    if (!inAppChannel) {
      throw new Error('In-app channel not configured');
    }
    return await inAppChannel.markAllAsRead(userId, category);
  }

  async getUnreadCount(userId, category = null) {
    const inAppChannel = this.channels.get(NotificationChannel.IN_APP);
    if (!inAppChannel) {
      throw new Error('In-app channel not configured');
    }
    return await inAppChannel.getUnreadCount(userId, category);
  }

  // Hook management
  addHook(type, handler) {
    if (this.hooks[type]) {
      this.hooks[type].push(handler);
    }
  }

  removeHook(type, handler) {
    if (this.hooks[type]) {
      const index = this.hooks[type].indexOf(handler);
      if (index > -1) {
        this.hooks[type].splice(index, 1);
      }
    }
  }

  // Metrics and monitoring
  async getMetrics(timeRange = '1 hour') {
    const deliveryMetrics = await this.deliveryService.getMetrics(timeRange);
    const channelMetrics = {};

    for (const [name, channel] of this.channels) {
      channelMetrics[name] = await channel.getMetrics();
    }

    return {
      delivery: deliveryMetrics,
      channels: channelMetrics
    };
  }

  // Utility methods
  generateNotificationId() {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async cleanup() {
    await this.deliveryService.cleanup();
    
    for (const [name, channel] of this.channels) {
      if (channel.cleanup) {
        await channel.cleanup();
      }
    }
  }
}

module.exports = NotificationModule;