# Notification Module

Multi-channel notification system for Fluxor with support for Email, SMS, Push, and In-app notifications.

## Features

- **Multi-channel Support**: Email, SMS, Push, and In-app notifications
- **Template System**: Handlebars-based templates with helpers
- **Delivery Management**: Queue-based delivery with retry logic
- **Tracking**: Delivery status, open rates, click tracking
- **Personalization**: Dynamic content rendering
- **Scheduling**: Send notifications at specific times
- **Batch Sending**: Efficient bulk notification delivery

## Installation

```bash
npm install @fluxor/notification
```

## Usage

### Basic Setup

```javascript
const NotificationModule = require('@fluxor/notification');

const notificationModule = new NotificationModule({
  channels: {
    email: {
      enabled: true,
      provider: {
        type: 'smtp',
        host: 'smtp.gmail.com',
        port: 587,
        auth: {
          user: 'your-email@gmail.com',
          pass: 'your-password'
        }
      }
    },
    sms: {
      enabled: true,
      provider: {
        type: 'twilio',
        accountSid: 'your-account-sid',
        authToken: 'your-auth-token',
        fromNumber: '+1234567890'
      }
    },
    push: {
      enabled: true,
      provider: {
        fcm: {
          serviceAccount: require('./firebase-service-account.json'),
          projectId: 'your-project-id'
        }
      }
    },
    inApp: {
      enabled: true
    }
  },
  delivery: {
    queue: {
      enabled: true,
      concurrency: 10
    },
    retry: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      }
    }
  }
});

// Initialize with dependencies
await notificationModule.initialize({
  database: databaseModule,
  eventBus: eventBusModule,
  websocket: websocketModule
});
```

### Sending Notifications

#### Using Templates

```javascript
// Create a template
await notificationModule.createTemplate({
  id: 'welcome_email',
  name: 'Welcome Email',
  channel: 'email',
  subject: 'Welcome to {{companyName}}, {{userName}}!',
  body: `
    <h1>Welcome {{userName}}!</h1>
    <p>Thank you for joining {{companyName}}.</p>
    <p>You have {{trialDays}} days in your free trial.</p>
    <a href="{{ctaUrl}}">Get Started</a>
  `
});

// Send using template
const result = await notificationModule.send({
  templateId: 'welcome_email',
  recipients: [
    {
      id: 'user123',
      email: 'user@example.com',
      metadata: { name: 'John Doe' }
    }
  ],
  data: {
    userName: 'John',
    companyName: 'Fluxor',
    trialDays: 30,
    ctaUrl: 'https://app.fluxor.com/onboarding'
  }
});
```

#### Direct Sending

```javascript
// Send without template
await notificationModule.sendDirect({
  channel: 'sms',
  recipients: [
    {
      id: 'user123',
      phone: '+1234567890'
    }
  ],
  subject: 'Order Update',
  body: 'Your order #12345 has been shipped!',
  options: {
    priority: 'high'
  }
});
```

#### Multi-channel Sending

```javascript
// Send to user across all channels
await notificationModule.sendToUser({
  userId: 'user123',
  templateId: 'order_shipped',
  data: {
    orderNumber: '12345',
    trackingUrl: 'https://track.example.com/12345'
  },
  channels: ['email', 'sms', 'push'] // or leave empty for all channels
});
```

### In-app Notifications

```javascript
// Get user notifications
const notifications = await notificationModule.getInAppNotifications('user123', {
  limit: 20,
  unreadOnly: true,
  category: 'order'
});

// Mark as read
await notificationModule.markAsRead('user123', 'notif123');

// Mark all as read
await notificationModule.markAllAsRead('user123', 'order');

// Get unread count
const count = await notificationModule.getUnreadCount('user123');
```

### Tracking and Analytics

```javascript
// Get delivery status
const status = await notificationModule.getDeliveryStatus('notif123');

// Update delivery status (webhook handler)
await notificationModule.updateDeliveryStatus('delivery123', 'opened', {
  openedAt: new Date(),
  metadata: {
    userAgent: 'Mozilla/5.0...',
    ipAddress: '192.168.1.1'
  }
});

// Get metrics
const metrics = await notificationModule.getMetrics('24 hours');
```

### Hooks and Customization

```javascript
// Add custom validation
notificationModule.addHook('beforeSend', async (notification, recipients) => {
  // Validate or modify notification
  if (notification.priority === 'marketing') {
    // Check user preferences
    recipients = recipients.filter(r => r.metadata.marketingOptIn);
  }
});

// Track sends
notificationModule.addHook('afterSend', async (notification, deliveries) => {
  // Log to analytics
  await analytics.track('notification_sent', {
    notificationId: notification.id,
    channel: notification.channel,
    recipientCount: deliveries.length
  });
});

// Handle errors
notificationModule.addHook('onError', async (error, notification, recipients) => {
  // Alert monitoring
  await monitoring.alert('notification_failed', {
    error: error.message,
    notification: notification.id
  });
});
```

## Configuration

### Channel Configuration

#### Email
```javascript
{
  email: {
    enabled: true,
    provider: {
      type: 'smtp', // or 'sendgrid', 'ses'
      // Provider-specific config
    },
    defaults: {
      from: 'noreply@example.com',
      replyTo: 'support@example.com'
    },
    tracking: {
      opens: true,
      clicks: true,
      baseUrl: 'https://track.example.com'
    }
  }
}
```

#### SMS
```javascript
{
  sms: {
    enabled: true,
    provider: {
      type: 'twilio', // or 'aws-sns', 'nexmo'
      // Provider-specific config
    },
    defaults: {
      maxLength: 160
    }
  }
}
```

#### Push
```javascript
{
  push: {
    enabled: true,
    provider: {
      fcm: {
        // Firebase config
      },
      apns: {
        // Apple Push config
      }
    }
  }
}
```

### Template Helpers

Built-in Handlebars helpers:

- `{{formatDate date "short"}}` - Date formatting
- `{{currency amount "USD"}}` - Currency formatting
- `{{pluralize count "item" "items"}}` - Pluralization
- `{{capitalize string}}` - String capitalization
- `{{truncate string 50}}` - String truncation
- Comparison helpers: `eq`, `ne`, `lt`, `gt`, `lte`, `gte`

## Events

The module emits the following events:

- `notification.delivery.initiated` - When delivery starts
- `notification.delivery.sent` - When successfully sent
- `notification.delivery.failed` - When delivery fails
- `notification.delivery.status_updated` - When status changes
- `notification.inapp.sent` - When in-app notification created
- `notification.inapp.read` - When marked as read
- `notification.inapp.action` - When user takes action

## API Reference

See the [API documentation](./docs/api.md) for detailed method descriptions.

## Examples

See the [examples directory](./examples) for more usage examples.