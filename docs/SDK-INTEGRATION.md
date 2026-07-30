# SDK integration

Install `@pulse-rn/sdk` in a React Native CLI app or Expo development build and configure it once during development startup.

```ts
if (__DEV__) {
  ReactNativeDevTool.configure({
    host: Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1',
    port: 9090,
    appName: 'MyApp',
    enableConsole: true,
    captureConsoleStackTrace: true,
    enableNetwork: true,
    captureRequestBodies: true,
    captureResponseBodies: true,
    maxNetworkBodyBytes: 102_400,
    redaction: {
      fields: ['password', 'otp', 'token'],
      headers: ['authorization', 'cookie'],
      queryParameters: ['api_key'],
    },
  }).connect();
}
```

Android Emulator maps the host loopback address to `10.0.2.2`. The iOS simulator can use `127.0.0.1`. Physical devices require a reachable LAN binding, which is intentionally disabled pending authenticated remote connections.

`allowInProduction` defaults to false. Leave it disabled. Events created offline remain in a bounded queue; the oldest event is dropped when the queue is full, and the dropped count is available through `client.getStats()`.

## Console capture

Set `enableConsole: true` to intercept `console.log`, `console.info`, `console.warn`, `console.error`, and `console.debug`. Original console methods still run. Values are converted to bounded JSON-safe structures, including circular references and Error objects, before redaction and transmission. Calling `disconnect()` restores the original methods.

Stack capture is enabled with `captureConsoleStackTrace`. Disable it when minimizing development overhead is more important than source locations.

## Network capture

Set `enableNetwork: true` to instrument global `fetch` and `XMLHttpRequest`. PulseRN clones fetch responses before reading them, so application code retains the original response stream. Binary content types are not captured. Text and JSON bodies are bounded by `maxNetworkBodyBytes` and marked when truncated.

For Axios instances with custom adapters, attach the optional interceptor:

```ts
const removeAxiosInterceptor = ReactNativeDevTool.client?.attachAxios(axios);
```

Call the returned function when disposing the Axios instance. Do not enable both a global capture path and an Axios interceptor if duplicate events for the same Axios request are undesirable.

## Redux capture

Install `@pulse-rn/redux-plugin` and add its middleware to Redux or Redux Toolkit:

```ts
import { createDevToolMiddleware } from '@pulse-rn/redux-plugin';
import { ReactNativeDevTool } from '@pulse-rn/sdk';

const pulseRNMiddleware = createDevToolMiddleware({
  client: ReactNativeDevTool,
  storeId: 'main',
  captureState: true,
  captureStateDiff: true,
  maxStateDepth: 10,
  redactedFields: ['token', 'password'],
});
```

With Redux Toolkit, append it using `middleware: (getDefaultMiddleware) =>
getDefaultMiddleware().concat(pulseRNMiddleware)`. With Redux, pass it to `applyMiddleware`.
Each configured `storeId` is independently filterable in the desktop app. The middleware observes
dispatch without mutating actions or state and does not implement state replay or time travel.

## Navigation capture

Install `@pulse-rn/navigation-plugin` and connect its tracker to React Navigation:

```tsx
const tracker = createNavigationTracker({
  client: ReactNativeDevTool,
  navigatorId: 'root',
  redactedFields: ['token', 'password'],
});

<NavigationContainer
  ref={navigationRef}
  onReady={() => tracker.onReady(navigationRef)}
  onStateChange={(state) => tracker.onStateChange(state, navigationRef)}
/>;
```

The tracker resolves nested active routes and records ready/state/focus/blur lifecycle events,
previous and current routes, sanitized parameters, and time spent on the previous route. Compatible
navigation refs can instead use `tracker.attach(navigationRef)`. Expo Router and custom navigation
systems can call `tracker.track({ route, action, lifecycle })`.

## Performance capture

Enable JavaScript-derived sampling in the SDK configuration:

```ts
ReactNativeDevTool.configure({
  // ...
  enablePerformance: true,
  performanceSampleIntervalMs: 1_000,
  javascriptStallThresholdMs: 100,
  captureMemory: false,
}).connect();
```

Create custom and screen measurements:

```ts
ReactNativeDevTool.performance.mark('checkout-start');
ReactNativeDevTool.performance.mark('checkout-complete');
ReactNativeDevTool.performance.measure('checkout-duration', 'checkout-start', 'checkout-complete');

ReactNativeDevTool.performance.startScreen('Checkout');
ReactNativeDevTool.performance.screenMounted('Checkout');
ReactNativeDevTool.performance.screenInteractive('Checkout');
ReactNativeDevTool.performance.endScreen('Checkout');
```

JavaScript FPS is calculated from animation-frame callback delivery, while event-loop lag and stalls
are calculated from timer drift. These values are explicitly marked approximate. They are useful for
finding JavaScript responsiveness regressions but are not native UI-thread, CPU, or memory profiling.
`captureMemory` emits data only when the runtime genuinely exposes JavaScript heap usage.
