# SDK integration

Install the single PulseRN package in a React Native CLI app or Expo development build:

```bash
npm install @pulse-rn/sdk
```

All PulseRN APIs are exported from `@pulse-rn/sdk`; there are no separate Redux, navigation, or
storage packages. Configure it once during development startup.

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

Android Emulator maps the host loopback address to `10.0.2.2`. The iOS simulator can use
`127.0.0.1`. For a physical device, enable authenticated LAN connections in PulseRN Settings and
configure the address, port, and copied token:

```ts
ReactNativeDevTool.configure({
  appName: 'MyApp',
  host: '192.168.1.20',
  port: 9090,
  authToken: 'token-copied-from-pulsern',
  secure: true,
}).connect();
```

`secure: true` selects `wss://` and must match the TLS setting in the desktop app. Configure a PEM
certificate and matching private key under **Settings → Device connections** first. The mobile
device must trust the issuing certificate authority, and the certificate must include the configured
hostname or IP in its subject alternative names. TLS does not replace `authToken` in LAN mode.

Without TLS, LAN mode uses plain `ws://`. Keep it on a trusted development network, rotate the token
after sharing it, and never commit a token or private key to source control. Loopback remains the
default and does not require a token.

## Persistent device identity

By default, every configured client creates a fresh device ID. To group launches under one stable
development device, persist an ID through an already-installed storage library:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOrCreatePulseRNDeviceId, ReactNativeDevTool } from '@pulse-rn/sdk';

const deviceId = await getOrCreatePulseRNDeviceId(AsyncStorage);

ReactNativeDevTool.configure({
  appName: 'MyApp',
  deviceId,
}).connect();
```

The helper has no native dependency of its own. It accepts any object with `getItem` and `setItem`,
validates an existing ID, and creates one only when missing or malformed. A custom key can be supplied
as the second argument.

`allowInProduction` defaults to false. Leave it disabled. Events created offline remain in a
bounded queue; the oldest event is dropped when the queue is full. PulseRN also pauses dequeueing
while the native WebSocket send buffer is saturated.

Inspect or subscribe to local transport diagnostics:

```ts
const client = ReactNativeDevTool.configure({
  appName: 'MyApp',
  onDiagnostics(diagnostics) {
    // Avoid logging this through an intercepted console in a real application.
    updateDeveloperStatus(diagnostics);
  },
});

client.getStats();
```

Diagnostics distinguish oversized-payload drops from queue-overflow drops and include queue depth,
sent events/batches, reconnect attempts, socket-buffer bytes, and approximate desktop clock offset.
`diagnosticsIntervalMs` defaults to 2 seconds. `maxSocketBufferBytes` defaults to 1 MiB.

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

Add the SDK middleware to Redux or Redux Toolkit:

```ts
import { createDevToolMiddleware, ReactNativeDevTool } from '@pulse-rn/sdk';

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

Connect the SDK tracker to React Navigation:

```tsx
import { createNavigationTracker, ReactNativeDevTool } from '@pulse-rn/sdk';

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

## Storage inspection

Install AsyncStorage in the app, enable storage, and register its adapter before connecting:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStorageProvider, ReactNativeDevTool } from '@pulse-rn/sdk';

const client = ReactNativeDevTool.configure({
  // ...
  enableStorage: true,
});

const unregister = client.registerStorageProvider(createAsyncStorageProvider(AsyncStorage));
client.connect();
```

The desktop app discovers registered providers and can list, search, read, refresh, update, and delete
keys. Every update and delete requires an explicit desktop confirmation. JSON values pass through
configured field redaction before being returned to Electron; editing is disabled when a displayed
value contains redaction markers so secrets cannot accidentally be overwritten.

MMKV v3/v4 can use the first-class adapter:

```ts
import { createMMKV } from 'react-native-mmkv';
import { createMMKVStorageProvider } from '@pulse-rn/sdk';

const mmkv = createMMKV({ id: 'app-cache' });
client.registerStorageProvider(
  createMMKVStorageProvider(mmkv, {
    id: 'mmkv-app-cache',
    name: 'MMKV · app-cache',
  }),
);
```

Register multiple MMKV instances with unique provider IDs to inspect them independently. String,
number, and boolean types are preserved when edited. ArrayBuffer values are visible as read-only
size markers because converting arbitrary binary data to editable text would be unsafe.

MMKV v4 requires both `react-native-mmkv` and `react-native-nitro-modules`. Expo apps must use a
development build/prebuild because Expo Go cannot load those custom native modules.

## Error capture

Enable automatic uncaught JavaScript error and unhandled-rejection capture:

```ts
ReactNativeDevTool.configure({
  appName: 'ExampleApp',
  enableErrors: true,
}).connect();
```

PulseRN preserves React Native's existing global error handler. Each error includes the current
screen, when known, and the previous 20 PulseRN timeline events.

Forward React error-boundary failures from `componentDidCatch`:

```ts
componentDidCatch(error: Error, info: React.ErrorInfo) {
  ReactNativeDevTool.captureError(error, {
    source: 'react_boundary',
    componentStack: info.componentStack ?? undefined,
  });
}
```

Use the same API for handled failures that remain important during debugging:

```ts
ReactNativeDevTool.captureError(error, {
  source: 'manual',
  metadata: { operation: 'checkout' },
});
```

Structured error metadata passes through configured field redaction. Avoid placing secrets directly
inside error messages or stack text because arbitrary strings cannot be safely field-redacted.

Custom storage can also be integrated without changing the protocol:

```ts
client.registerStorageProvider({
  id: 'custom',
  name: 'Custom storage',
  getAllKeys: async () => storage.getAllKeys(),
  getItem: async (key) => storage.getString(key) ?? null,
  setItem: async (key, value) => storage.set(key, value),
  removeItem: async (key) => storage.delete(key),
});
```
