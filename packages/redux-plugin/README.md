# @pulse-rn/redux-plugin

Redux and Redux Toolkit-compatible middleware for recording actions, state snapshots, state diffs,
and reducer duration in PulseRN.

## Install

```bash
pnpm add -D @pulse-rn/redux-plugin
```

The package is intended for development tooling. Keep the middleware behind your application’s
development guard when configuring the production store.

## Setup

```ts
import { configureStore } from '@reduxjs/toolkit';
import { ReactNativeDevTool } from '@pulse-rn/sdk';
import { createDevToolMiddleware } from '@pulse-rn/redux-plugin';

const pulseRNMiddleware = createDevToolMiddleware({
  client: ReactNativeDevTool,
  storeId: 'main',
  captureState: true,
  captureStateDiff: true,
  maxStateDepth: 10,
  redactedFields: ['password', 'token'],
});

export const store = configureStore({
  reducer,
  middleware: (getDefaultMiddleware) =>
    __DEV__ ? getDefaultMiddleware().concat(pulseRNMiddleware) : getDefaultMiddleware(),
});
```

For a plain Redux store, add the returned middleware with `applyMiddleware`.

## Options

- `client`: PulseRN SDK client or another compatible event target
- `storeId`: distinguishes events when an app has multiple stores; defaults to `default`
- `captureState`: includes previous and next state snapshots; defaults to `true`
- `captureStateDiff`: includes path-level added, removed, and changed values; defaults to `true`
- `maxStateDepth`: bounds serialization depth; defaults to `10`
- `redactedFields`: removes sensitive fields before events leave the application
- `actionFilter`: skips unwanted or high-frequency actions

Circular values, errors, dates, functions, symbols, bigints, and unsupported numeric values are
converted into safe protocol values. Reducer duration is measured around the downstream middleware
and reducer call.

## Minimal middleware

```ts
createDevToolMiddleware({
  client: ReactNativeDevTool,
  storeId: 'main',
  captureState: true,
  captureStateDiff: true,
  maxStateDepth: 10,
  redactedFields: ['token'],
});
```

See the repository [SDK integration guide](../../docs/SDK-INTEGRATION.md) for client configuration.
