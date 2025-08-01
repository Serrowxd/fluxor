const twilio = require('twilio');
const BaseChannel = require('./BaseChannel');
const { NotificationChannel, NotificationStatus } = require('../types');

class SMSChannel extends BaseChannel {
  constructor(config) {
    super(config);
    this.client = null;
  }

  async initialize() {
    if (!this.enabled || !this.config.provider) {
      return;
    }

    const { provider } = this.config;

    switch (provider.type) {
      case 'twilio':
        this.client = twilio(provider.accountSid, provider.authToken);
        this.fromNumber = provider.fromNumber;
        break;

      case 'aws-sns':
        const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
        this.client = new SNSClient({ region: provider.region });
        this.snsClient = true;
        break;

      case 'nexmo':
        const { Vonage } = require('@vonage/server-sdk');
        this.client = new Vonage({
          apiKey: provider.apiKey,
          apiSecret: provider.apiSecret
        });
        this.fromNumber = provider.fromNumber;
        break;

      default:
        throw new Error(`Unsupported SMS provider type: ${provider.type}`);
    }
  }

  validateRecipient(recipient) {
    return recipient.phone && this.isValidPhoneNumber(recipient.phone);
  }

  isValidPhoneNumber(phone) {
    // Basic validation - should start with + and contain only digits
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    return phoneRegex.test(phone.replace(/\s/g, ''));
  }

  formatPhoneNumber(phone) {
    // Remove all non-digit characters except +
    return phone.replace(/[^\d+]/g, '');
  }

  async send(notification, recipient) {
    if (!this.validateRecipient(recipient)) {
      throw new Error('Invalid SMS recipient');
    }

    if (!this.client) {
      throw new Error('SMS channel not initialized');
    }

    const options = this.getOptions(notification.options?.sms);
    const phoneNumber = this.formatPhoneNumber(recipient.phone);

    try {
      let result;

      if (this.config.provider.type === 'twilio') {
        result = await this.sendViaTwilio(notification, phoneNumber, options);
      } else if (this.config.provider.type === 'aws-sns') {
        result = await this.sendViaSNS(notification, phoneNumber, options);
      } else if (this.config.provider.type === 'nexmo') {
        result = await this.sendViaNexmo(notification, phoneNumber, options);
      }

      return this.formatDelivery({
        notificationId: notification.id,
        recipientId: recipient.id,
        channel: NotificationChannel.SMS,
        status: NotificationStatus.SENT,
        providerResponse: result,
        metadata: {
          to: phoneNumber,
          messageLength: notification.body.length,
          segments: this.calculateSegments(notification.body)
        }
      });
    } catch (error) {
      return this.formatDelivery({
        notificationId: notification.id,
        recipientId: recipient.id,
        channel: NotificationChannel.SMS,
        status: NotificationStatus.FAILED,
        error: this.handleError(error)
      });
    }
  }

  async sendViaTwilio(notification, phoneNumber, options) {
    const message = await this.client.messages.create({
      body: this.truncateMessage(notification.body, options.maxLength),
      from: options.from || this.fromNumber,
      to: phoneNumber,
      statusCallback: options.statusCallback,
      ...(options.mediaUrl ? { mediaUrl: options.mediaUrl } : {})
    });

    return {
      sid: message.sid,
      status: message.status,
      price: message.price,
      priceUnit: message.priceUnit,
      numSegments: message.numSegments
    };
  }

  async sendViaSNS(notification, phoneNumber, options) {
    const { PublishCommand } = require('@aws-sdk/client-sns');
    
    const command = new PublishCommand({
      Message: this.truncateMessage(notification.body, options.maxLength),
      PhoneNumber: phoneNumber,
      MessageAttributes: options.attributes || {},
      ...(options.smsType ? { MessageStructure: 'SMS', SMSType: options.smsType } : {})
    });

    const response = await this.client.send(command);

    return {
      messageId: response.MessageId,
      sequenceNumber: response.SequenceNumber
    };
  }

  async sendViaNexmo(notification, phoneNumber, options) {
    const response = await this.client.sms.send({
      from: options.from || this.fromNumber,
      to: phoneNumber,
      text: this.truncateMessage(notification.body, options.maxLength),
      type: options.unicode ? 'unicode' : 'text',
      ...(options.callback ? { callback: options.callback } : {})
    });

    return {
      messageId: response.messages[0]['message-id'],
      status: response.messages[0].status,
      remainingBalance: response.messages[0]['remaining-balance'],
      messagePrice: response.messages[0]['message-price']
    };
  }

  truncateMessage(message, maxLength = 1600) {
    if (message.length <= maxLength) {
      return message;
    }

    // Truncate and add ellipsis
    return message.substring(0, maxLength - 3) + '...';
  }

  calculateSegments(message) {
    // SMS segment calculation
    // GSM-7: 160 chars for 1 segment, 153 for multi
    // Unicode: 70 chars for 1 segment, 67 for multi
    const isUnicode = /[^\x00-\x7F]/.test(message);
    const singleSegmentLength = isUnicode ? 70 : 160;
    const multiSegmentLength = isUnicode ? 67 : 153;

    if (message.length <= singleSegmentLength) {
      return 1;
    }

    return Math.ceil(message.length / multiSegmentLength);
  }

  async isAvailable() {
    if (!this.enabled || !this.client) {
      return false;
    }

    try {
      // Provider-specific health checks
      if (this.config.provider.type === 'twilio') {
        await this.client.api.accounts(this.config.provider.accountSid).fetch();
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  async getMetrics() {
    const base = await super.getMetrics();
    
    return {
      ...base,
      provider: this.config.provider?.type,
      fromNumber: this.fromNumber,
      features: {
        multimedia: this.config.provider?.type === 'twilio',
        unicode: true,
        delivery_reports: true
      }
    };
  }
}

module.exports = SMSChannel;