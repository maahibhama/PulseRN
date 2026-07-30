# Architecture

## Decisions

PulseRN is a pnpm/Turborepo monorepo. The wire contract is independent of Electron and React Native, and all runtime boundaries validate unknown input. JSON is the initial codec; envelopes retain an explicit version so MessagePack or Protobuf codecs can be added later.

Electron main is the trusted desktop boundary. It owns WebSocket connections, session state, SQLite, and operating-system integration. Preload exposes only typed snapshot reads/subscriptions. The renderer has `contextIsolation`, `sandbox`, and disabled Node integration.

The JavaScript debugger is a separate, Electron-main-owned connection to a single Hermes runtime
through Metro's loopback Chrome DevTools Protocol proxy. Electron validates target discovery and CDP
messages, resolves source maps, persists debugger preferences, and exposes only narrow debugger
commands and snapshots through preload. The renderer never receives a raw debugger WebSocket.

Desktop preferences cross a narrow validated preload IPC boundary and are atomically persisted as a
user-only JSON file in Electron's platform-specific `userData` directory. Electron main applies
native theme, login-item, and macOS window-lifecycle preferences; renderer-only display preferences
are applied from the same synchronized settings object.

Storage inspection uses a narrow request/response path from renderer IPC through Electron main to a
specific negotiated WebSocket connection. The SDK dispatches commands only to registered providers
and returns bounded results. This provider boundary supports AsyncStorage now and future MMKV/custom
adapters without coupling the transport to a storage library.

Error instrumentation wraps React Native's global handler while preserving its normal behavior and
uses runtime error/rejection events where available. React error boundaries forward through the
public capture API. Before batching, the SDK attaches the active navigation screen and a bounded,
redacted summary of the preceding 20 events.

SQLite writes use WAL mode and batched transactions. A small in-memory projection feeds the Phase 1 UI; later phases will use paginated queries and TanStack Virtual for 100,000-event sessions.

## Package responsibilities

- `apps/desktop`: Electron main, preload, React renderer, local persistence, and connection server.
- `apps/example-react-native`: runnable Expo integration example.
- `apps/example-react-native-cli`: bare React Native Community CLI integration example with committed native projects.
- `packages/protocol`: message types, schemas, negotiation, and JSON decoding boundary.
- `packages/sdk`: development-only transport client and event queue.
- `packages/shared`: runtime-neutral IDs and recursive redaction.
- `packages/redux-plugin`: Redux/RTK middleware and state-diff capture.
- `packages/navigation-plugin`: React Navigation lifecycle and manual route instrumentation.

## Data flow

```text
React Native SDK
  → batch + redact + sequence
  → ws://127.0.0.1:9090
  → parse JSON as unknown
  → Zod protocol validation + negotiation
  → SQLite transaction + in-memory session projection
  → validated Electron IPC snapshot
  → Zustand renderer store
  → unified timeline and details panel
```

## Session model

The SDK creates a device ID and session ID when configured. A connection ID represents one WebSocket lifetime. Reconnection preserves device/session identity for that configured client and receives a new connection ID.
