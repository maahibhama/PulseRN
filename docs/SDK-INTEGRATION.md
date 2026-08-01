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
    environment: 'development',
    enableConsole: true,
    captureConsoleStackTrace: true,
    maxConsoleEventsPerMinute: 6_000,
    consoleSerialization: {
      maxDepth: 8,
      maxProperties: 200,
      maxStringLength: 20_000,
    },
    enableNetwork: true,
    captureRequestBodies: true,
    captureResponseBodies: true,
    maxNetworkBodyBytes: 102_400,
    maxNetworkRequestBytes: 262_144,
    maxNetworkSessionBytes: 10_485_760,
    redaction: {
      fields: ['password', 'otp', 'token'],
      headers: ['authorization', 'cookie'],
      queryParameters: ['api_key'],
    },
    categories: {
      console: true,
      network: true,
      redux: true,
      navigation: true,
      performance: true,
      storage: true,
      error: true,
    },
    sampling: {
      performance: 0.5,
    },
    onDroppedEvent(notice) {
      updateDeveloperDropIndicator(notice);
    },
  }).connect();
}
```

Android Emulator maps the host loopback address to `10.0.2.2`. The iOS simulator can use
`127.0.0.1`. For a physical device, enable authenticated LAN connections and create a one-time code
in PulseRN. Persist the reconnect token with an application-owned development storage provider:

```ts
const client = ReactNativeDevTool.configure({
  appName: 'MyApp',
  host: '192.168.1.20',
  port: 9090,
  pairingCode: 'ABCD-EFGH',
  reconnectToken: savedReconnectToken,
  onReconnectToken: async (token) => {
    await saveReconnectToken(token);
  },
  secure: true,
});

client.connect();
```

`secure: true` selects `wss://` and must match the TLS setting in the desktop app. Configure a PEM
certificate and matching private key under **Settings → Device connections** first. The mobile
device must trust the issuing certificate authority, and the certificate must include the configured
hostname or IP in its subject alternative names. TLS does not replace pairing in LAN mode.

Without TLS, LAN mode uses plain `ws://`. Keep it on a trusted development network and never commit
a pairing code, reconnect token, or private key. Loopback remains the default and needs no pairing.

## Persistent device and session identity

By default, every configured client creates a fresh device ID. To group launches under one stable
development device, persist an ID through an already-installed storage library:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOrCreatePulseRNIdentity, ReactNativeDevTool } from '@pulse-rn/sdk';

const identity = await getOrCreatePulseRNIdentity(AsyncStorage, {
  // Keep this stable through Fast Refresh. Change it on a cold launch, logout,
  // or another application-defined session boundary.
  lifecycleId: developmentLifecycleId,
});

ReactNativeDevTool.configure({
  appName: 'MyApp',
  ...identity,
}).connect();
```

The helper has no native dependency of its own. It accepts any object with `getItem` and `setItem`,
validates existing values, preserves a device identity, and rotates the session only when the
lifecycle changes or `newSession: true` is requested. `ReactNativeDevTool.configureWithIdentity`
combines this step with client configuration. `getOrCreatePulseRNDeviceId` remains available when
only a stable device ID is required.

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
client.getDiagnosticSummary();
const unsubscribe = client.subscribeConnectionState((state) => {
  updateConnectionBadge(state);
});
```

Diagnostics distinguish oversized-payload drops from queue-overflow drops and include queue depth,
sent events/batches, reconnect attempts, socket-buffer bytes, and approximate desktop clock offset.
`diagnosticsIntervalMs` defaults to 2 seconds. `maxSocketBufferBytes` defaults to 1 MiB.

`validatePulseRNConfig` can validate configuration before creating a client. `environment` supplies
development-safe defaults, `categories` disables unneeded inspectors, `sampling` accepts per-category
rates from `0` to `1`, and `onDroppedEvent` reports category-disabled, sampled, payload-budget,
queue-overflow, and console-rate-limit drops without throwing into application code.

## Console capture

Set `enableConsole: true` to intercept `console.log`, `console.info`, `console.warn`, `console.error`, and `console.debug`. Original console methods still run. Values are converted to bounded JSON-safe structures, including circular references and Error objects, before redaction and transmission. Calling `disconnect()` restores the original methods.

Stack capture is enabled with `captureConsoleStackTrace`. Disable it when minimizing development overhead is more important than source locations.

Use `maxConsoleEventsPerMinute` to bound noisy applications and `consoleSerialization` to cap object
depth, property count, and string length before transport. PulseRN marks redacted and truncated
console payloads explicitly. The Console inspector reports console-specific transport drops and lets
the user choose a bounded 250–2,000 record display window without deleting persisted history.

## Network capture

Set `enableNetwork: true` to instrument global `fetch` and `XMLHttpRequest`. PulseRN clones fetch
responses before reading them, so application code retains the original response stream. Additive
start, progress, redirect, completion, and failure events let the desktop show in-flight requests
while the existing completed-request event remains available to protocol v1 readers.

Binary content types are never captured. Secrets are redacted before persistence, and text/JSON
bodies are governed by three independent budgets:

- `maxNetworkBodyBytes` truncates a single body.
- `maxNetworkRequestBytes` can omit request or response bodies when their combined capture exceeds
  the request budget.
- `maxNetworkSessionBytes` stops body capture for the rest of that client session once its shared
  budget is exhausted.

The desktop labels budget omissions and approximate React Native timing instead of inventing
fine-grained DNS, connection, or transfer measurements. Its Network inspector provides lifecycle
progress, redirect chains, request initiators, correlation IDs, a waterfall, lazy body/header/query
views, sanitized copy-as-cURL, and sanitized HAR export. HAR and cURL generation reapply sensitive
header redaction.

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
  maxStateProperties: 10_000,
  maxStateBytes: 524_288,
  stateSizeWarningBytes: 262_144,
  actionAllowList: ['checkout/*', 'profile/*'],
  actionDenyList: ['analytics/noisy'],
  actionCategories: {
    checkout: ['checkout/*'],
    profile: ['profile/*'],
  },
  enabledCategories: ['checkout', 'profile'],
  getCorrelationContext: () => ({
    route: currentRouteName,
    requestId: activeRequestId,
    correlationId: activeFlowId,
  }),
  redactedFields: ['token', 'password'],
});
```

With Redux Toolkit, append it using `middleware: (getDefaultMiddleware) =>
getDefaultMiddleware().concat(pulseRNMiddleware)`. With Redux, pass it to `applyMiddleware`.
Each configured `storeId` is independently filterable in the desktop app. The middleware observes
dispatch without mutating actions or state and does not implement state replay or time travel.
Allow/deny patterns support exact action names and a trailing `*` prefix match. Category policy is
configured independently for each middleware/store instance. Serialization stops at the configured
depth/property/byte limits, emits state-size and truncation metadata, and derives a bounded changed
path summary. The desktop lazily expands state/action branches and diffs rather than stringifying a
complete selected state eagerly. Correlation context is optional and can associate actions with the
active route, request, error, performance stall, and parent timeline flow.

## Navigation capture

Connect the SDK tracker to React Navigation:

```tsx
import { createNavigationTracker, ReactNativeDevTool } from '@pulse-rn/sdk';

const tracker = createNavigationTracker({
  client: ReactNativeDevTool,
  navigatorId: 'root',
  source: 'react-navigation',
  integrationMetadata: { library: '@react-navigation/native' },
  redactedFields: ['token', 'password'],
  getCorrelationContext: () => ({
    correlationId: activeFlowId,
    requestId: activeRequestId,
    reduxEventId: latestReduxEventId,
  }),
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

Phase 16 normalizes React Navigation, Expo Router, and manual inputs into the same route path and
flat ownership tree while retaining `source` and `integrationMetadata`. Supply stable, unique
`navigatorId` values and keyed routes. PulseRN warns about duplicate navigator IDs, unkeyed or
incomplete tracking, and inconsistent ancestry. Parameter diffs, grouped forward/back/reset
actions, screen-duration history, and optional request/Redux/performance/console/error correlations
remain read-only.

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

Performance samples identify JavaScript/runtime provenance, the sampling interval, estimated lost
samples, and capture rate. PulseRN reports missing animation-frame and JS-heap capabilities
explicitly. Native CPU, UI-thread, and native-memory profiling are reported as unavailable rather
than replaced with synthetic values. The desktop provides selectable time ranges and configurable
JS FPS, stall, slow-screen, network-latency, and memory-growth thresholds, plus comparisons when
matching app/platform sessions are loaded.

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

The desktop app discovers registered providers, pages keys in bounded 100-key windows, and retrieves
values only when selected. It reports provider capabilities and validates JSON, number, boolean, and
binary values before enabling edits. Every update, delete, and restore requires an explicit desktop
confirmation. Before a mutation, the SDK keeps the original value in an opaque, single-session
backup; Electron receives only a single-use backup identifier for undo. Raw backup values never
enter the desktop database.

Read-only snapshots and audit metadata are stored locally by Electron. JSON values pass through
configured field redaction before being returned to Electron; editing and snapshots are disabled
for sensitive, redacted, or binary values. Export includes only values explicitly selected by the
user and excludes sensitive, redacted, binary, unavailable, or missing values.

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
