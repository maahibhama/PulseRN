# Known limitations

- React Native 0.76+, Hermes, and development builds are the supported baseline.
- Expo Go is unsupported; use an Expo development build.
- Native-log capture supports iOS Simulator and Android Emulator, not physical devices.
- `appId` must equal the native bundle/application identifier for automatic PID lookup.
- One active Hermes runtime can be debugged at a time, and another debugger may own the target.
- Performance metrics are JavaScript/runtime observations, not native CPU or UI-thread profiling.
- Linux desktop builds are x86-64 only.
- Unsigned previews may trigger Gatekeeper or SmartScreen and cannot auto-install updates.
- Storage mutations are development-only, explicitly confirmed, and provider-dependent.
- PulseRN complements rather than replaces React Native DevTools, Xcode, and Android Studio.

Please open a focused [bug report](https://github.com/maahibhama/PulseRN/issues/new/choose) when a
documented supported workflow does not work.
