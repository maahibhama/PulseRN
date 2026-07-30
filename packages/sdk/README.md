# @pulse-rn/sdk

The single-package React Native SDK for the PulseRN desktop debugger. It supports React Native CLI
applications and Expo development builds.

## Install

```bash
npm install @pulse-rn/sdk
```

Native storage integrations remain application dependencies. Install AsyncStorage or MMKV only when
the application uses the corresponding provider.

## Use

All public APIs are available from one import path:

```ts
import {
  createAsyncStorageProvider,
  createDevToolMiddleware,
  createMMKVStorageProvider,
  createNavigationTracker,
  createPulseRNClient,
  diffStates,
  getActiveRoute,
  ReactNativeDevTool,
} from '@pulse-rn/sdk';

const client = ReactNativeDevTool.configure({
  host: '127.0.0.1',
  port: 9090,
  appName: 'MyApp',
  enableConsole: true,
  enableNetwork: true,
  enableErrors: true,
});

client.connect();
```

PulseRN is intended for development builds. Production connections stay disabled unless explicitly
enabled with `allowInProduction`.

See the repository's [SDK integration guide](https://github.com/maahibhama/PulseRN/blob/main/docs/SDK-INTEGRATION.md)
for Redux, navigation, AsyncStorage, MMKV, performance, and error-capture examples.
