# Development

Use Node 22 LTS and pnpm 10.14.

```bash
pnpm install
pnpm dev:desktop
```

In another terminal, generate, compile, and install the custom native example:

```bash
pnpm --filter @pulse-rn/example-react-native ios
# or
pnpm --filter @pulse-rn/example-react-native android
```

The example contains MMKV/Nitro native modules and therefore cannot run in Expo Go. Once the
development app is installed, start subsequent Metro sessions with:

```bash
pnpm --filter @pulse-rn/example-react-native dev
```

To use the same demos without Expo, install the committed Community CLI app:

```bash
cd apps/example-react-native-cli/ios
pod install
cd ../../..
pnpm --filter @pulse-rn/example-react-native-cli start
```

Then run `pnpm --filter @pulse-rn/example-react-native-cli ios` or
`pnpm --filter @pulse-rn/example-react-native-cli android` in another terminal.

Workspace packages build before dependents through Turborepo. Persistence uses the `node:sqlite` API bundled with Electron, so contributors do not need to rebuild a third-party native addon.

The desktop database is stored under Electron's platform-specific `userData` directory, not in the repository.

Electron currently labels its bundled `node:sqlite` API experimental and may print that warning on startup. The database is local and disposable during Phase 1; schema access remains isolated behind `EventDatabase` so the implementation can be replaced without changing the transport or renderer.
