# Feature Flags Documentation

This document explains how to use the feature flag system in the Inventory Manager application.

## Demo Mode Feature Flag

The demo mode feature flag allows you to enable a demo version of the application in production without requiring real authentication or backend services.

### Demo Mode Status

Demo mode is **enabled by default** in the application. This means users will see the "Try Demo" button on the login page without any additional configuration.

### How to Disable Demo Mode

If you want to disable demo mode, set the following environment variable:

```bash
NEXT_PUBLIC_DEMO_MODE_ENABLED=false
```

Then restart your Next.js development server or redeploy your production application.

### How Demo Mode Works

When demo mode is enabled:

- **Login Page**: Shows a "Try Demo" button that allows users to access the application with sample data
- **Demo User**: Creates a demo user with ID `demo-user-456` and email `demo@inventorymanager.com`
- **Sample Data**: Provides realistic inventory and sales data for demonstration purposes
- **Local Storage**: Demo user data is stored in localStorage under the key `demo_user`
- **Settings**: Demo users can modify settings (stored locally)
- **No Backend Required**: All functionality works without a backend server

### Demo User Details

- **User ID**: `demo-user-456`
- **Email**: `demo@inventorymanager.com`
- **Default Settings**:
  - Low stock threshold: 15
  - Alert email enabled: true
  - Time zone: UTC

### Feature Flag Configuration

The feature flag system is located in `lib/feature-flags.ts` and can be extended to include additional flags:

```typescript
export interface FeatureFlags {
  DEMO_MODE_ENABLED: boolean;
  // Add more flags here
  // ENABLE_NEW_FEATURE: boolean
  // BETA_FEATURES_ENABLED: boolean
}
```

### Usage in Components

To check if a feature is enabled in your components:

```typescript
import { isFeatureEnabled } from "@/lib/feature-flags";

// Check if demo mode is enabled
if (isFeatureEnabled("DEMO_MODE_ENABLED")) {
  // Show demo-specific content
}
```

### Security Considerations

- Demo mode is intended for demonstration purposes only
- Demo users have access to sample data only
- No real Shopify integration or backend API calls are made
- Demo user data is stored locally and is not persisted to any database

### Demo Mode Behavior

- **When Enabled (Default)**: Users can access the demo mode and explore the application with sample data
- **When Disabled**: The demo mode button is hidden and users must use real authentication

The application will require real authentication and backend services when demo mode is disabled.
