# @pulse-rn/redux-plugin

Redux and Redux Toolkit-compatible middleware for recording actions, state snapshots, state diffs,
and reducer duration in PulseRN.

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
