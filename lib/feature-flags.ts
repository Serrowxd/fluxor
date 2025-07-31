// Feature Flags Configuration
// This file contains all feature flags for the application
// You can toggle these flags to enable/disable features in production

export interface FeatureFlags {
  // Demo mode allows users to access the application with dummy data
  // without requiring real authentication or backend services
  DEMO_MODE_ENABLED: boolean;

  // Additional feature flags can be added here
  // ENABLE_NEW_FEATURE: boolean
  // BETA_FEATURES_ENABLED: boolean
}

// Default feature flags configuration
// Set these values to control which features are enabled
export const FEATURE_FLAGS: FeatureFlags = {
  DEMO_MODE_ENABLED: process.env.NEXT_PUBLIC_DEMO_MODE_ENABLED !== "false", // Enabled by default, can be disabled with "false"
};

// Helper function to check if a feature is enabled
export function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  return FEATURE_FLAGS[feature];
}

// Helper function to get all feature flags (useful for debugging)
export function getAllFeatureFlags(): FeatureFlags {
  return { ...FEATURE_FLAGS };
}
