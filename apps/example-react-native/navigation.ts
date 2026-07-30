import { createNavigationTracker, ReactNativeDevTool } from '@pulse-rn/sdk';

export const navigationTracker = createNavigationTracker({
  client: ReactNativeDevTool,
  navigatorId: 'expo-root',
  source: 'expo-router',
  redactedFields: ['token', 'password'],
});
