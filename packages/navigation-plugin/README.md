# @pulse-rn/navigation-plugin

React Navigation-compatible and manual route instrumentation for PulseRN.

```ts
const tracker = createNavigationTracker({
  client: ReactNativeDevTool,
  navigatorId: 'root',
  redactedFields: ['token'],
});

<NavigationContainer
  ref={navigationRef}
  onReady={() => tracker.onReady(navigationRef)}
  onStateChange={(state) => tracker.onStateChange(state, navigationRef)}
/>;
```

`tracker.attach(navigationRef)` can subscribe to compatible state/focus/blur listeners. Expo Router and
custom navigators can call `tracker.track({ route, action })`.
