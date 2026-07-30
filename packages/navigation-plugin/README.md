# @pulse-rn/navigation-plugin

React Navigation-compatible and manual route instrumentation for PulseRN.

## Install

```bash
pnpm add -D @pulse-rn/navigation-plugin
```

## React Navigation setup

```ts
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { ReactNativeDevTool } from '@pulse-rn/sdk';
import { createNavigationTracker } from '@pulse-rn/navigation-plugin';

const navigationRef = createNavigationContainerRef();
const tracker = createNavigationTracker({
  client: ReactNativeDevTool,
  navigatorId: 'root',
  redactedFields: ['password', 'token'],
});

<NavigationContainer
  ref={navigationRef}
  onReady={() => tracker.onReady(navigationRef)}
  onStateChange={(state) => tracker.onStateChange(state, navigationRef)}
/>;
```

The tracker resolves the active route through nested navigation state, records route transitions and
lifecycle events, and measures time spent on the previous route.

## Subscription API

For compatible navigation references, `attach` registers state, focus, and blur listeners:

```ts
const detach = tracker.attach(navigationRef);

// Remove listeners when the integration is disposed.
detach();
```

## Expo Router and custom navigators

Use the manual API when lifecycle callbacks or a navigation state reference are not available:

```ts
const tracker = createNavigationTracker({
  client: ReactNativeDevTool,
  navigatorId: 'expo-router',
  source: 'expo-router',
  redactedFields: ['token'],
});

tracker.track({
  lifecycle: 'state',
  action: 'navigate',
  route: {
    name: 'checkout',
    path: '/checkout',
    params: { orderId: '123', token: 'redacted before transmission' },
  },
});
```

Supported actions are `navigate`, `push`, `pop`, `replace`, `reset`, `back`, and `unknown`.
Supported lifecycle values are `ready`, `state`, `focus`, and `blur`.

## Options

- `client`: required PulseRN SDK client or compatible event target
- `navigatorId`: distinguishes multiple navigators; defaults to `root`
- `source`: `react-navigation`, `expo-router`, or `manual`
- `redactedFields`: removes sensitive route parameters before transmission
- `maxParamDepth`: bounds parameter serialization depth; defaults to `10`

Call `tracker.dispose()` when the tracker is no longer needed. See the repository
[SDK integration guide](../../docs/SDK-INTEGRATION.md) for client configuration.
