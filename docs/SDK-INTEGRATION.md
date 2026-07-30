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
    enableNetwork: true,
    captureRequestBodies: true,
    captureResponseBodies: true,
    maxNetworkBodyBytes: 102_400,
    redaction: {
      fields: ['password', 'otp', 'token'],
      headers: ['authorization', 'cookie'],
      queryParameters: ['api_key'],
    },
  }).connect();
}
```

Android Emulator maps the host loopback address to `10.0.2.2`. The iOS simulator can use `127.0.0.1`. Physical devices require a reachable LAN binding, which is intentionally disabled pending authenticated remote connections.

`allowInProduction` defaults to false. Leave it disabled. Events created offline remain in a bounded queue; the oldest event is dropped when the queue is full, and the dropped count is available through `client.getStats()`.

## Console capture

Set `enableConsole: true` to intercept `console.log`, `console.info`, `console.warn`, `console.error`, and `console.debug`. Original console methods still run. Values are converted to bounded JSON-safe structures, including circular references and Error objects, before redaction and transmission. Calling `disconnect()` restores the original methods.

Stack capture is enabled with `captureConsoleStackTrace`. Disable it when minimizing development overhead is more important than source locations.

## Network capture

Set `enableNetwork: true` to instrument global `fetch` and `XMLHttpRequest`. PulseRN clones fetch responses before reading them, so application code retains the original response stream. Binary content types are not captured. Text and JSON bodies are bounded by `maxNetworkBodyBytes` and marked when truncated.

For Axios instances with custom adapters, attach the optional interceptor:

```ts
const removeAxiosInterceptor = ReactNativeDevTool.client?.attachAxios(axios);
```

Call the returned function when disposing the Axios instance. Do not enable both a global capture path and an Axios interceptor if duplicate events for the same Axios request are undesirable.
