import { createNavigationTracker, ReactNativeDevTool } from '@pulse-rn/sdk';

export const navigationTracker = createNavigationTracker({
  client: ReactNativeDevTool,
  navigatorId: 'expo-root',
  source: 'expo-router',
  integrationMetadata: { integration: 'expo-router', routeConvention: 'file-based' },
  redactedFields: ['token', 'password'],
});
