// Notification types and enums

const NotificationStatus = {
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  BOUNCED: 'bounced',
  OPENED: 'opened',
  CLICKED: 'clicked'
};

const NotificationChannel = {
  EMAIL: 'email',
  SMS: 'sms',
  PUSH: 'push',
  IN_APP: 'in_app'
};

const NotificationPriority = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent'
};

const NotificationCategory = {
  SYSTEM: 'system',
  ORDER: 'order',
  INVENTORY: 'inventory',
  ALERT: 'alert',
  MARKETING: 'marketing',
  SECURITY: 'security'
};

// TypeScript-like type definitions (for documentation purposes)
// In a real TypeScript project, these would be interfaces

/**
 * @typedef {Object} NotificationRecipient
 * @property {string} id - Recipient identifier
 * @property {string} [email] - Email address
 * @property {string} [phone] - Phone number
 * @property {string} [deviceToken] - Push notification device token
 * @property {string} [userId] - User ID for in-app notifications
 * @property {Object} [metadata] - Additional recipient metadata
 */

/**
 * @typedef {Object} NotificationTemplate
 * @property {string} id - Template identifier
 * @property {string} name - Template name
 * @property {string} channel - Notification channel
 * @property {string} subject - Subject/title template
 * @property {string} body - Body template (supports Handlebars)
 * @property {Object} [metadata] - Template metadata
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} NotificationRequest
 * @property {string} [id] - Request ID (auto-generated if not provided)
 * @property {string} templateId - Template to use
 * @property {NotificationRecipient[]} recipients - List of recipients
 * @property {Object} data - Template data for rendering
 * @property {string} [channel] - Override template channel
 * @property {string} priority - Notification priority
 * @property {string} [category] - Notification category
 * @property {Date} [scheduledAt] - Schedule for later delivery
 * @property {Object} [options] - Channel-specific options
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} NotificationDelivery
 * @property {string} id - Delivery ID
 * @property {string} notificationId - Parent notification ID
 * @property {string} recipientId - Recipient ID
 * @property {string} channel - Delivery channel
 * @property {string} status - Delivery status
 * @property {Date} sentAt - When sent
 * @property {Date} [deliveredAt] - When delivered
 * @property {Date} [openedAt] - When opened
 * @property {Date} [clickedAt] - When clicked
 * @property {Object} [error] - Error details if failed
 * @property {Object} [providerResponse] - Provider-specific response
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} ChannelConfig
 * @property {boolean} enabled - Whether channel is enabled
 * @property {Object} provider - Provider configuration
 * @property {Object} [defaults] - Default options
 * @property {Object} [limits] - Rate limits
 */

/**
 * @typedef {Object} NotificationConfig
 * @property {Object.<string, ChannelConfig>} channels - Channel configurations
 * @property {Object} queue - Queue configuration
 * @property {Object} storage - Storage configuration
 * @property {Object} tracking - Tracking configuration
 * @property {Object} retry - Retry configuration
 */

module.exports = {
  NotificationStatus,
  NotificationChannel,
  NotificationPriority,
  NotificationCategory
};