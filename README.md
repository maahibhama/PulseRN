# PulseRN

PulseRN is an open-source desktop debugging foundation for React Native. Its central idea is a unified, chronological timeline that will correlate app interactions, navigation, Redux, network, rendering, performance, and errors.

> Status: Phase 2. The foundation and Console inspector are working. Network, Redux, navigation, performance, storage, and dedicated error instrumentation are scheduled for later phases.

## What works today

- Electron desktop app with a sandboxed renderer and narrow preload bridge
- Loopback-only WebSocket server on port `9090`
- Versioned JSON protocol with Zod validation and negotiation
- React Native SDK with development-build protection, reconnection, batching, sequencing, bounded offline buffering, payload limits, and field redaction
- Multiple connected-device tracking
- SQLite event persistence
- Initial unified timeline and event-detail view
- Console interception for log, info, warn, error, and debug
- Console filtering, search, pause, clear, payload expansion, copy, source, and stack inspection
- Expo-based React Native integration example

![Screenshot placeholder](docs/assets/screenshot-placeholder.svg)

## Requirements

- Node.js 20.19 or newer (Node 22 LTS recommended)
- pnpm 10.14
- Xcode for the iOS simulator, or Android Studio for the Android emulator

## Install and run

```bash
pnpm install
pnpm dev:desktop
```

In a second terminal:

```bash
pnpm --filter @pulse-rn/example-react-native dev
```

Use `10.0.2.2` for the Android emulator, `127.0.0.1` for the iOS simulator, and the desktop machine's LAN address for a physical device:

```bash
EXPO_PUBLIC_PULSE_RN_HOST=192.168.1.20 pnpm --filter @pulse-rn/example-react-native dev
```

The server deliberately binds to loopback in Phase 1. To use a physical device, the desktop host binding must first be made configurable with authentication; see [SECURITY.md](docs/SECURITY.md).

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm lint
```

## SDK setup

```ts
import { ReactNativeDevTool } from '@pulse-rn/sdk';

if (__DEV__) {
  ReactNativeDevTool.configure({
    host: '127.0.0.1',
    port: 9090,
    appName: 'ExampleApp',
    redaction: { fields: ['password', 'token'] },
  }).connect();
}
```

See [SDK integration](docs/SDK-INTEGRATION.md), [architecture](docs/ARCHITECTURE.md), and the [roadmap](docs/ROADMAP.md).

## Known limitations

- Phase 2 only accepts JSON and has no transport authentication UI.
- The UI keeps the latest 2,000 events in memory; database pagination and list virtualization arrive before high-volume instrumentation.
- The example uses Expo and does not commit generated `ios/` or `android/` projects.
- Session export/import and later inspection panels are not implemented yet.
- Console object field redaction is implemented; header and URL-specific redaction will land with network instrumentation.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), [DEVELOPMENT.md](docs/DEVELOPMENT.md), and [SECURITY.md](docs/SECURITY.md) before opening a change. PulseRN is licensed under the [MIT License](LICENSE).
