const nodemailer = require('nodemailer');
const BaseChannel = require('./BaseChannel');
const { NotificationChannel, NotificationStatus } = require('../types');

class EmailChannel extends BaseChannel {
  constructor(config) {
    super(config);
    this.transporter = null;
  }

  async initialize() {
    if (!this.enabled || !this.config.provider) {
      return;
    }

    const { provider } = this.config;

    // Support multiple email providers
    switch (provider.type) {
      case 'smtp':
        this.transporter = nodemailer.createTransport({
          host: provider.host,
          port: provider.port,
          secure: provider.secure !== false,
          auth: {
            user: provider.auth.user,
            pass: provider.auth.pass
          },
          ...provider.options
        });
        break;

      case 'sendgrid':
        this.transporter = nodemailer.createTransport({
          service: 'SendGrid',
          auth: {
            user: 'apikey',
            pass: provider.apiKey
          }
        });
        break;

      case 'ses':
        // AWS SES configuration
        const aws = require('@aws-sdk/client-ses');
        const { defaultProvider } = require('@aws-sdk/credential-provider-node');
        
        this.transporter = nodemailer.createTransport({
          SES: {
            ses: new aws.SES({
              region: provider.region,
              credentials: defaultProvider()
            }),
            aws
          }
        });
        break;

      default:
        throw new Error(`Unsupported email provider type: ${provider.type}`);
    }

    // Verify transporter configuration
    if (this.transporter) {
      await this.transporter.verify();
    }
  }

  validateRecipient(recipient) {
    return recipient.email && this.isValidEmail(recipient.email);
  }

  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  async send(notification, recipient) {
    if (!this.validateRecipient(recipient)) {
      throw new Error('Invalid email recipient');
    }

    if (!this.transporter) {
      throw new Error('Email channel not initialized');
    }

    const options = this.getOptions(notification.options?.email);

    try {
      // Prepare email message
      const message = {
        from: options.from || this.config.provider.defaultFrom,
        to: recipient.email,
        subject: notification.subject,
        html: notification.body,
        text: notification.plainText || this.htmlToText(notification.body),
        headers: options.headers || {},
        attachments: options.attachments || [],
        ...this.getAdditionalOptions(options)
      };

      // Add tracking pixel if enabled
      if (options.tracking?.opens) {
        message.html = this.addTrackingPixel(message.html, notification.id, recipient.id);
      }

      // Add unsubscribe link if configured
      if (options.unsubscribe) {
        message.html = this.addUnsubscribeLink(message.html, recipient.id);
        message.headers['List-Unsubscribe'] = options.unsubscribe.url;
      }

      // Send email
      const result = await this.transporter.sendMail(message);

      return this.formatDelivery({
        notificationId: notification.id,
        recipientId: recipient.id,
        channel: NotificationChannel.EMAIL,
        status: NotificationStatus.SENT,
        providerResponse: {
          messageId: result.messageId,
          response: result.response,
          accepted: result.accepted,
          rejected: result.rejected
        },
        metadata: {
          from: message.from,
          to: message.to,
          subject: message.subject
        }
      });
    } catch (error) {
      return this.formatDelivery({
        notificationId: notification.id,
        recipientId: recipient.id,
        channel: NotificationChannel.EMAIL,
        status: NotificationStatus.FAILED,
        error: this.handleError(error)
      });
    }
  }

  htmlToText(html) {
    // Simple HTML to text conversion
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  addTrackingPixel(html, notificationId, recipientId) {
    const trackingUrl = `${this.config.tracking?.baseUrl}/track/open/${notificationId}/${recipientId}`;
    const pixel = `<img src="${trackingUrl}" width="1" height="1" border="0" alt="" />`;
    
    // Add before closing body tag
    return html.replace(/<\/body>/i, `${pixel}</body>`);
  }

  addUnsubscribeLink(html, recipientId) {
    const unsubscribeUrl = `${this.config.unsubscribe?.baseUrl}/unsubscribe/${recipientId}`;
    const link = `<p style="text-align: center; font-size: 12px; color: #999;">
      <a href="${unsubscribeUrl}">Unsubscribe</a>
    </p>`;
    
    // Add before closing body tag
    return html.replace(/<\/body>/i, `${link}</body>`);
  }

  getAdditionalOptions(options) {
    const additional = {};

    // Priority headers
    if (options.priority === 'high' || options.priority === 'urgent') {
      additional.priority = 'high';
      additional.headers = {
        ...additional.headers,
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high'
      };
    }

    // Reply-to
    if (options.replyTo) {
      additional.replyTo = options.replyTo;
    }

    // CC and BCC
    if (options.cc) {
      additional.cc = options.cc;
    }
    if (options.bcc) {
      additional.bcc = options.bcc;
    }

    return additional;
  }

  async isAvailable() {
    if (!this.enabled || !this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
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
      features: {
        tracking: !!this.config.tracking,
        unsubscribe: !!this.config.unsubscribe
      }
    };
  }
}

module.exports = EmailChannel;