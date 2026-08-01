# @pulse-rn/sdk

[![npm version](https://img.shields.io/npm/v/@pulse-rn/sdk.svg)](https://www.npmjs.com/package/@pulse-rn/sdk)
[![license](https://img.shields.io/github/license/maahibhama/PulseRN)](https://github.com/maahibhama/PulseRN/blob/main/LICENSE)

The single-package React Native SDK for the PulseRN desktop debugger. It supports React Native CLI
applications and Expo development builds.

## Install

Install the public package from the official npm registry. GitHub Packages configuration and
authentication are not required.

```bash
npm install @pulse-rn/sdk
```

```bash
pnpm add @pulse-rn/sdk
# or
yarn add @pulse-rn/sdk
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
  getOrCreatePulseRNDeviceId,
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

Physical devices can connect through the desktop's opt-in LAN mode by setting `host`, `port`, and
`authToken`. LAN transport is plain `ws://`; use it only on a trusted development network and never
commit the copied token.

Use `getOrCreatePulseRNDeviceId(AsyncStorage)` and pass the result as `deviceId` when device history
should remain stable across development app launches. The storage library remains an application
dependency and is not imported eagerly by PulseRN.

See the repository's [SDK integration guide](https://github.com/maahibhama/PulseRN/blob/main/docs/SDK-INTEGRATION.md)
for Redux, navigation, AsyncStorage, MMKV, performance, and error-capture examples.

## Links

- [npm package](https://www.npmjs.com/package/@pulse-rn/sdk)
- [GitHub repository](https://github.com/maahibhama/PulseRN)
- [Desktop releases](https://github.com/maahibhama/PulseRN/releases)
- [Issues](https://github.com/maahibhama/PulseRN/issues)
