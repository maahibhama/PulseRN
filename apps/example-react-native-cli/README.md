# PulseRN React Native CLI example

A bare React Native Community CLI application that exercises every current
PulseRN inspector without Expo:

- Console logs and structured events
- Network requests
- Redux actions, state, and state diffs
- Navigation transitions
- Performance measurements
- Captured errors
- AsyncStorage and MMKV

## Requirements

- Node.js 22.11 or newer
- Xcode and CocoaPods for iOS
- Android Studio/JDK 17 for Android
- The PulseRN desktop app running on port `9090`

Install workspace dependencies from the repository root:

```sh
pnpm install
```

Install iOS pods:

```sh
cd apps/example-react-native-cli/ios
pod install
```

Start Metro from the repository root:

```sh
pnpm --filter @pulse-rn/example-react-native-cli start
```

In a second terminal, launch a native target:

```sh
pnpm --filter @pulse-rn/example-react-native-cli ios
```

or:

```sh
pnpm --filter @pulse-rn/example-react-native-cli android
```

The iOS Simulator connects to `127.0.0.1:9090`. The Android Emulator connects
to `10.0.2.2:9090`. For a USB-connected Android device, run:

```sh
adb reverse tcp:9090 tcp:9090
adb reverse tcp:8081 tcp:8081
```

For a physical iOS device, replace the `host` constant near the top of
`App.tsx` with the development machine's LAN address.
