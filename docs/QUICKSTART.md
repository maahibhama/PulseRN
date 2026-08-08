# Five-minute quick start

PulseRN works with React Native 0.76+ development builds. Expo Go is not supported because it cannot
load an application-specific native dependency graph or expose the native process identity required
by all PulseRN integrations.

## 1. Start PulseRN

```bash
npx @maahibhama/pulsern
```

The browser opens automatically. Keep this terminal running.

## 2. Install and connect the SDK

```bash
npm install --save-dev @pulse-rn/sdk
```

Add this to the development entry point before rendering the app:

```ts
import { Platform } from 'react-native';
import { ReactNativeDevTool } from '@pulse-rn/sdk';

if (__DEV__) {
  const pulseRN = ReactNativeDevTool.configure({
    host: Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1',
    port: 9090,
    appId: 'com.example.myapp', // Android application ID or iOS bundle identifier
    appName: 'My App',
    device: { platform: Platform.OS },
    enableConsole: true,
    enableNetwork: true,
    enableErrors: true,
  });
  pulseRN.connect();
  console.info('PulseRN connected');
}
```

Restart the development app and select **Console**. The connection and message should appear. Do
not include PulseRN in a production entry path.

## Expo development build

Use `npx expo run:ios` or `npx expo run:android` to create a development build, then run Metro with
`npx expo start --dev-client`. Expo Go cannot run this integration.

## Bare React Native

Run the normal `npm run ios` or `npm run android` command after installing the SDK. Rebuild only when
a native dependency changes; SDK configuration itself is JavaScript.

## Explore before integrating

Select **Explore demo** in the PulseRN header. The offline session is clearly named “PulseRN Demo,”
does not require an emulator, and remains separate from real application sessions. Visit each
inspector to follow the example checkout failure.

## Troubleshooting

- **Nothing connects:** confirm port `9090` is available and the app is a development build.
- **Android Emulator:** use `10.0.2.2`, or run `adb reverse tcp:9090 tcp:9090` and use `127.0.0.1`.
- **Wrong native app:** `appId` must exactly match the Android application ID or iOS bundle ID.
- **Ambiguous native target:** set `device.nativeTargetId` to an `adb devices` serial or a UDID from
  `xcrun simctl list devices booted`.
- **Missing Android logs:** verify `adb` is available and the emulator appears in `adb devices`.
- **Missing iOS logs:** verify Xcode command-line tools and `xcrun simctl` are available.
- **Hermes unavailable:** start Metro on port `8081`, ensure Hermes is enabled, and close another
  debugger that already owns the target.
- **Physical device:** use authenticated LAN pairing from **Connections**; native-log capture v1 is
  limited to virtual devices.

For complete configuration, see [SDK integration](SDK-INTEGRATION.md) and the
[browser CLI guide](WEB-CLI.md).
