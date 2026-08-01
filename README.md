# PulseRN

[![npm version](https://img.shields.io/npm/v/@pulse-rn/sdk.svg)](https://www.npmjs.com/package/@pulse-rn/sdk)
[![GitHub release](https://img.shields.io/github/v/release/maahibhama/PulseRN?label=desktop)](https://github.com/maahibhama/PulseRN/releases)
[![license](https://img.shields.io/github/license/maahibhama/PulseRN)](LICENSE)

[Website and documentation](https://maahibhama.github.io/PulseRN-Site/)

PulseRN is an open-source desktop debugging foundation for React Native. Its central idea is a unified, chronological timeline that will correlate app interactions, navigation, Redux, network, rendering, performance, and errors.

> Status: Phase 10. The inspectors are working, with scalable persistence and transport hardening now in progress.

## What works today

- Electron desktop app with a sandboxed renderer and narrow preload bridge
- Loopback-only WebSocket server on port `9090`
- Versioned JSON protocol with Zod validation and negotiation
- React Native SDK with development-build protection, reconnection, batching, sequencing, bounded offline buffering, socket backpressure protection, transport health diagnostics, payload limits, and field redaction
- Multiple connected-device tracking
- SQLite event persistence with configurable age/count retention and recovery cleanup
- Cursor-paginated unified timeline and category inspectors with bounded timeline virtualization
- Console interception for log, info, warn, error, and debug
- Console filtering, search, pause, clear, payload expansion, copy, source, and stack inspection
- Fetch and XMLHttpRequest inspection with optional Axios interceptors
- Network status/method filters, URL search, failed-request highlighting, body truncation, and detail tabs
- Redux/Redux Toolkit middleware with action, state, diff, reducer timing, redaction, and multi-store inspection
- React Navigation and manual route instrumentation with lifecycle events, nested routes, parameter redaction, and route timing
- Performance monitoring with approximate JS FPS, event-loop lag/stalls, startup/screen/custom timing, optional available heap metrics, and correlated slow-operation views
- AsyncStorage and MMKV inspection with provider discovery, key search/read/refresh, JSON redaction, type-preserving MMKV edits, and explicitly confirmed update/delete operations
- Error inspection for uncaught JavaScript failures, unhandled rejections, React error boundaries, network failures, and SDK errors with stack traces and 20 preceding timeline events
- Native Hermes JavaScript debugger with original TypeScript sources, breakpoints, line stepping, call stacks, scopes, watches, evaluation, and exception pausing
- Persistent desktop settings for system/light/dark themes, interface density, timeline ordering, launch at login, and macOS background behavior
- Compact, rounded light and dark application icons that follow the selected theme, including live macOS system-theme changes
- Expo development-build and bare React Native Community CLI examples covering Console, Network, Redux, Navigation, Performance, AsyncStorage, MMKV, and Errors

## Screenshots

### Unified desktop timeline

![PulseRN desktop debugger showing the unified event timeline](docs/assets/pulsern-timeline.png)

### React Native Community CLI example

<p align="center">
  <img
    src="docs/assets/pulsern-react-native-example.png"
    alt="PulseRN React Native Community CLI example running in the iOS Simulator"
    width="420"
  />
</p>

## Requirements

- Node.js 20.19 or newer (Node 22 LTS recommended)
- pnpm 10.14
- Xcode for the iOS simulator, or Android Studio for the Android emulator

## Install the desktop app

PulseRN preview releases are available from
[GitHub Releases](https://github.com/maahibhama/PulseRN/releases). They are currently unsigned, so
macOS Gatekeeper and Windows SmartScreen display a warning.

### Homebrew

```bash
brew tap maahibhama/pulsern https://github.com/maahibhama/PulseRN
brew install --cask --no-quarantine pulsern
```

### macOS DMG

Download `PulseRN-<version>-mac-arm64.dmg` for Apple Silicon (M1 and newer), or
`PulseRN-<version>-mac-x64.dmg` for Intel. Open it and drag PulseRN to Applications. If Gatekeeper
blocks the preview, right-click PulseRN and choose **Open**.

### Windows

Download the x64 installer for most Windows PCs or the ARM64 installer for Windows on ARM. If
SmartScreen appears, select **More info** and then **Run anyway**.

### Linux

Use the portable AppImage:

```bash
chmod +x PulseRN-<version>-linux-x64.AppImage
./PulseRN-<version>-linux-x64.AppImage
```

Or install the Debian package:

```bash
sudo apt install ./PulseRN-<version>-linux-x64.deb
```

See [desktop installation](docs/INSTALLATION.md) for verification, upgrades, and uninstall
instructions.

Maintainers can prepare and publish a complete version-tag release with:

```bash
pnpm release:desktop 0.1.0
```

## Develop locally

```bash
pnpm install
pnpm dev:desktop
```

In a second terminal:

```bash
# Expo development build
pnpm --filter @pulse-rn/example-react-native ios
# or
pnpm --filter @pulse-rn/example-react-native android

# Bare React Native Community CLI
pnpm --filter @pulse-rn/example-react-native-cli ios
# or
pnpm --filter @pulse-rn/example-react-native-cli android
```

The first `ios` or `android` run generates and installs a custom Expo development build containing
MMKV and its Nitro native module. Expo Go cannot run this example. After the development app is
installed, use the following command for normal Metro restarts:

```bash
pnpm --filter @pulse-rn/example-react-native dev
```

If native dependencies change, rebuild the development app with the `ios` or `android` command
instead of only restarting Metro.

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

The React Native SDK is published publicly on
[npm](https://www.npmjs.com/package/@pulse-rn/sdk). npm is the official package registry; no
GitHub Packages configuration or authentication token is required.

```bash
npm install @pulse-rn/sdk
```

Equivalent commands:

```bash
pnpm add @pulse-rn/sdk
# or
yarn add @pulse-rn/sdk
```

```ts
import {
  createDevToolMiddleware,
  createNavigationTracker,
  ReactNativeDevTool,
} from '@pulse-rn/sdk';

if (__DEV__) {
  ReactNativeDevTool.configure({
    host: '127.0.0.1',
    port: 9090,
    appName: 'ExampleApp',
    redaction: { fields: ['password', 'token'] },
  }).connect();
}
```

See [SDK integration](docs/SDK-INTEGRATION.md), [architecture](docs/ARCHITECTURE.md), and the
[roadmap](docs/ROADMAP.md). Source code, issues, and contributions live in the
[GitHub repository](https://github.com/maahibhama/PulseRN); downloadable desktop builds are
published through [GitHub Releases](https://github.com/maahibhama/PulseRN/releases).

## Desktop preferences

Open **Settings** in the Electron sidebar to configure:

- System, dark, or light appearance
- Comfortable or compact interface density
- Newest-first or oldest-first timeline ordering
- Local Metro discovery port for the Hermes debugger
- Launch at login on packaged macOS builds
- Whether closing the window keeps PulseRN running in the background

Appearance changes apply immediately to the debugger, header branding, window icon, and macOS Dock
icon. With **System** selected, PulseRN follows macOS automatically.

## JavaScript line debugger

Open **Debugger**, refresh Metro targets, and select a Hermes development runtime. PulseRN supports
React Native 0.76+ development builds and defaults to Metro on `127.0.0.1:8081`; change the port in
Settings when needed. See [JavaScript debugger](docs/JAVASCRIPT-DEBUGGER.md) for breakpoint
controls, keyboard shortcuts, examples, and current limitations.

## Known limitations

- The transport only accepts validated JSON and has no authentication UI.
- Live updates keep a bounded 2,000-event projection in memory; inspectors page older retained history from SQLite.
- The Expo example uses prebuild; the Community CLI example includes committed native iOS and Android projects.
- Session export/import is not implemented yet.
- Console fields, network headers, URL query parameters, and structured request/response fields are redacted before transmission.
- Performance FPS, event-loop, and SDK app-start metrics are JavaScript-derived approximations, not native CPU or UI-thread profiling.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), [DEVELOPMENT.md](docs/DEVELOPMENT.md), and [SECURITY.md](docs/SECURITY.md) before opening a change. PulseRN is licensed under the [MIT License](LICENSE).
