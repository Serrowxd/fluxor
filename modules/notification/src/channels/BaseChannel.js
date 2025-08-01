const { NotificationStatus } = require('../types');

class BaseChannel {
  constructor(config = {}) {
    this.config = config;
    this.enabled = config.enabled !== false;
  }

  /**
   * Initialize the channel
   */
  async initialize() {
    // Override in subclasses
  }

  /**
   * Send notification through this channel
   * @param {NotificationRequest} notification
   * @param {NotificationRecipient} recipient
   * @returns {Promise<NotificationDelivery>}
   */
  async send(notification, recipient) {
    throw new Error('send() method must be implemented by channel');
  }

  /**
   * Validate recipient for this channel
   * @param {NotificationRecipient} recipient
   * @returns {boolean}
   */
  validateRecipient(recipient) {
    throw new Error('validateRecipient() method must be implemented by channel');
  }

  /**
   * Get channel-specific options with defaults
   * @param {Object} options
   * @returns {Object}
   */
  getOptions(options = {}) {
    return {
      ...this.config.defaults,
      ...options
    };
  }

  /**
   * Handle provider-specific errors
   * @param {Error} error
   * @returns {Object}
   */
  handleError(error) {
    return {
      code: error.code || 'UNKNOWN_ERROR',
      message: error.message,
      details: error
    };
  }

  /**
   * Format delivery result
   * @param {Object} params
   * @returns {NotificationDelivery}
   */
  formatDelivery({
    notificationId,
    recipientId,
    channel,
    status = NotificationStatus.SENT,
    providerResponse = null,
    error = null,
    metadata = {}
  }) {
    const now = new Date();
    
    return {
      id: `${channel}_${notificationId}_${recipientId}_${Date.now()}`,
      notificationId,
      recipientId,
      channel,
      status,
      sentAt: now,
      deliveredAt: status === NotificationStatus.DELIVERED ? now : null,
      error,
      providerResponse,
      metadata
    };
  }

  /**
   * Check if channel is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return this.enabled;
  }

  /**
   * Get channel metrics
   * @returns {Promise<Object>}
   */
  async getMetrics() {
    return {
      enabled: this.enabled,
      available: await this.isAvailable()
    };
  }
}

module.exports = BaseChannel;