# SDK integration

Install `@pulse-rn/sdk` in a React Native CLI app or Expo development build and configure it once during development startup.

```ts
if (__DEV__) {
  ReactNativeDevTool.configure({
    host: Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1',
    port: 9090,
    appName: 'MyApp',
    enableConsole: true,
    captureConsoleStackTrace: true,
    redaction: { fields: ['password', 'otp', 'token'] },
  }).connect();
}
```

Android Emulator maps the host loopback address to `10.0.2.2`. The iOS simulator can use `127.0.0.1`. Physical devices require a reachable LAN binding, which is intentionally disabled pending authenticated remote connections.

`allowInProduction` defaults to false. Leave it disabled. Events created offline remain in a bounded queue; the oldest event is dropped when the queue is full, and the dropped count is available through `client.getStats()`.

## Console capture

Set `enableConsole: true` to intercept `console.log`, `console.info`, `console.warn`, `console.error`, and `console.debug`. Original console methods still run. Values are converted to bounded JSON-safe structures, including circular references and Error objects, before redaction and transmission. Calling `disconnect()` restores the original methods.

Stack capture is enabled with `captureConsoleStackTrace`. Disable it when minimizing development overhead is more important than source locations.
