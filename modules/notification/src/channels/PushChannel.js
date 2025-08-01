const admin = require('firebase-admin');
const BaseChannel = require('./BaseChannel');
const { NotificationChannel, NotificationStatus } = require('../types');

class PushChannel extends BaseChannel {
  constructor(config) {
    super(config);
    this.fcm = null;
    this.apns = null;
  }

  async initialize() {
    if (!this.enabled || !this.config.provider) {
      return;
    }

    const { provider } = this.config;

    // Initialize Firebase Cloud Messaging
    if (provider.fcm) {
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(provider.fcm.serviceAccount),
          projectId: provider.fcm.projectId
        });
      }
      this.fcm = admin.messaging();
    }

    // Initialize Apple Push Notification Service
    if (provider.apns) {
      const apn = require('apn');
      this.apns = new apn.Provider({
        token: {
          key: provider.apns.key,
          keyId: provider.apns.keyId,
          teamId: provider.apns.teamId
        },
        production: provider.apns.production !== false
      });
    }

    // Initialize other providers (OneSignal, Pusher, etc.)
    if (provider.custom) {
      await this.initializeCustomProvider(provider.custom);
    }
  }

  validateRecipient(recipient) {
    return recipient.deviceToken || recipient.userId;
  }

  async send(notification, recipient) {
    if (!this.validateRecipient(recipient)) {
      throw new Error('Invalid push notification recipient');
    }

    const options = this.getOptions(notification.options?.push);

    try {
      let result;

      // Determine platform and send accordingly
      if (recipient.deviceToken) {
        const platform = this.detectPlatform(recipient.deviceToken, recipient.metadata?.platform);
        
        if (platform === 'ios' && this.apns) {
          result = await this.sendViaAPNS(notification, recipient, options);
        } else if (this.fcm) {
          result = await this.sendViaFCM(notification, recipient, options);
        } else {
          throw new Error('No push notification provider configured for platform');
        }
      } else if (recipient.userId && this.fcm) {
        // Topic-based notification using userId
        result = await this.sendToTopic(notification, recipient.userId, options);
      }

      return this.formatDelivery({
        notificationId: notification.id,
        recipientId: recipient.id,
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.SENT,
        providerResponse: result,
        metadata: {
          platform: recipient.metadata?.platform,
          deviceToken: recipient.deviceToken ? '***' + recipient.deviceToken.slice(-4) : null
        }
      });
    } catch (error) {
      return this.formatDelivery({
        notificationId: notification.id,
        recipientId: recipient.id,
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.FAILED,
        error: this.handleError(error)
      });
    }
  }

  async sendViaFCM(notification, recipient, options) {
    const message = {
      token: recipient.deviceToken,
      notification: {
        title: notification.subject,
        body: notification.body,
        ...(options.image ? { imageUrl: options.image } : {})
      },
      data: {
        notificationId: notification.id,
        category: notification.category || 'general',
        ...notification.data
      },
      android: this.getAndroidConfig(notification, options),
      apns: this.getAPNSConfig(notification, options),
      webpush: this.getWebPushConfig(notification, options)
    };

    // Set priority
    if (options.priority === 'high' || options.priority === 'urgent') {
      message.android = {
        ...message.android,
        priority: 'high'
      };
      message.apns = {
        ...message.apns,
        headers: {
          ...message.apns?.headers,
          'apns-priority': '10'
        }
      };
    }

    const response = await this.fcm.send(message);
    
    return {
      messageId: response,
      success: true
    };
  }

  async sendViaAPNS(notification, recipient, options) {
    const apn = require('apn');
    
    const note = new apn.Notification({
      alert: {
        title: notification.subject,
        body: notification.body
      },
      badge: options.badge,
      sound: options.sound || 'default',
      contentAvailable: options.contentAvailable,
      mutableContent: options.mutableContent,
      category: notification.category,
      threadId: options.threadId,
      payload: {
        notificationId: notification.id,
        ...notification.data
      }
    });

    // Set expiry
    note.expiry = Math.floor(Date.now() / 1000) + (options.ttl || 3600);
    
    // Set priority
    if (options.priority === 'high' || options.priority === 'urgent') {
      note.priority = 10;
    } else {
      note.priority = 5;
    }

    const result = await this.apns.send(note, recipient.deviceToken);
    
    return {
      sent: result.sent.length,
      failed: result.failed.length,
      failures: result.failed
    };
  }

  async sendToTopic(notification, topic, options) {
    const message = {
      topic: `user_${topic}`,
      notification: {
        title: notification.subject,
        body: notification.body
      },
      data: {
        notificationId: notification.id,
        ...notification.data
      }
    };

    const response = await this.fcm.send(message);
    
    return {
      messageId: response,
      topic: message.topic
    };
  }

  detectPlatform(deviceToken, providedPlatform) {
    if (providedPlatform) {
      return providedPlatform.toLowerCase();
    }

    // Basic heuristic - iOS tokens are typically 64 characters
    if (deviceToken.length === 64 && /^[a-f0-9]+$/i.test(deviceToken)) {
      return 'ios';
    }

    // Default to Android/FCM
    return 'android';
  }

  getAndroidConfig(notification, options) {
    const config = {
      collapseKey: options.collapseKey,
      restrictedPackageName: options.androidPackageName,
      data: options.androidData
    };

    if (options.androidNotification) {
      config.notification = {
        icon: options.androidNotification.icon,
        color: options.androidNotification.color,
        sound: options.androidNotification.sound,
        tag: options.androidNotification.tag,
        clickAction: options.androidNotification.clickAction,
        channelId: options.androidNotification.channelId
      };
    }

    return config;
  }

  getAPNSConfig(notification, options) {
    const config = {
      headers: {},
      payload: {
        aps: {}
      }
    };

    if (options.apnsHeaders) {
      config.headers = options.apnsHeaders;
    }

    if (options.apnsPayload) {
      config.payload = {
        ...config.payload,
        ...options.apnsPayload
      };
    }

    return config;
  }

  getWebPushConfig(notification, options) {
    if (!options.webpush) {
      return undefined;
    }

    return {
      headers: options.webpush.headers,
      data: options.webpush.data,
      notification: {
        ...options.webpush.notification,
        actions: options.webpush.actions
      },
      fcmOptions: options.webpush.fcmOptions
    };
  }

  async initializeCustomProvider(config) {
    // Implement custom provider initialization
    // This could be OneSignal, Pusher Beams, etc.
  }

  async isAvailable() {
    return this.enabled && (this.fcm !== null || this.apns !== null);
  }

  async getMetrics() {
    const base = await super.getMetrics();
    
    return {
      ...base,
      providers: {
        fcm: this.fcm !== null,
        apns: this.apns !== null
      },
      features: {
        topics: true,
        rich_media: true,
        silent_push: true,
        web_push: this.fcm !== null
      }
    };
  }
}

module.exports = PushChannel;