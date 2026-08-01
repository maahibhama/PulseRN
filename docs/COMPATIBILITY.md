# Compatibility

| Component           | Supported baseline                        | Notes                                                        |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| React Native        | 0.76+                                     | Hermes development builds; new architecture supported        |
| Repository examples | 0.86.2                                    | Expo development build and Community CLI                     |
| Expo                | Development builds                        | Expo Go cannot load optional custom native storage modules   |
| Hermes debugger     | Metro CDP, one target                     | JSC and production runtimes are unsupported                  |
| iOS                 | Current Xcode simulator/device toolchains | Physical LAN devices require pairing                         |
| Android             | Current emulator/device toolchains        | Use `10.0.2.2` or `adb reverse` for local ports              |
| macOS desktop       | Apple Silicon and Intel                   | Separate DMGs; unsigned previews show Gatekeeper warnings    |
| Windows desktop     | x64 and ARM64                             | Separate NSIS installers; unsigned previews show SmartScreen |
| Linux desktop       | x86-64                                    | AppImage and Debian package                                  |
| SDK modules         | ESM, CommonJS, TypeScript, Metro          | Optional integrations remain application dependencies        |

Protocol v1 remains readable. Newer behavior uses additive fields and capability negotiation.
Unsupported future database, archive, settings, or update metadata versions fail closed.
