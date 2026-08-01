# Architecture

## Decisions

PulseRN is a pnpm/Turborepo monorepo. The wire contract is independent of Electron and React Native, and all runtime boundaries validate unknown input. JSON is the initial codec; envelopes retain an explicit version so MessagePack or Protobuf codecs can be added later.

Electron main is the trusted desktop boundary. It owns WebSocket connections, session state, SQLite, and operating-system integration. Preload exposes only typed snapshot reads/subscriptions. The renderer has `contextIsolation`, `sandbox`, and disabled Node integration.

SQLite history is bounded independently of renderer lifetime. Main-process maintenance removes records
outside the configured age and count limits, repairs session counts, and discards malformed JSON rows.
It runs at startup, after retention changes, and at most once per minute while events are arriving.

Transport health is an optional protocol capability. Compatible SDKs report bounded queue, drop,
send, reconnect, clock-offset, and native WebSocket-buffer metrics. Health updates cross a dedicated
validated IPC subscription so they do not retransmit the in-memory event projection. The SDK stops
dequeueing batches while the native socket buffer exceeds its configured threshold.

The SDK server binds to `127.0.0.1` by default. LAN mode is an explicit preference that restarts the
server on `0.0.0.0` and requires a generated 256-bit token in every client hello. The token is stored
separately from renderer-visible settings with user-only permissions, compared in constant time, and
revealed only through narrow copy/rotation commands. Optional TLS wraps the same WebSocket server in
HTTPS using a user-selected PEM certificate and matching private key. Electron main validates and
stores the credentials with user-only permissions; preload exposes only certificate metadata and
narrow install/disable commands. A broken persisted TLS configuration falls back to loopback rather
than exposing an unauthenticated or unexpectedly plaintext LAN listener.

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

SQLite writes use WAL mode and batched transactions. Versioned migrations preserve existing event
databases and maintain session metadata. Timeline and category inspectors read deterministic cursor
pages through a validated preload boundary. Category inspectors query only the histories they need,
while the bounded in-memory projection drives live connection updates.

The desktop acceptance harness launches the production renderer in the real Electron runtime and
drives it through Chromium's loopback debugging endpoint. It verifies sandbox isolation, the narrow
preload API, SDK WebSocket ingestion, persisted pagination, inspector navigation, settings, and
maintenance. A separate 25,000-event load test traverses every cursor page before enforcing retention.

Session archives use the versioned `pulse-rn-session` JSON format. Electron main owns native file
dialogs and filesystem access, caps imports at 100 MiB, validates the complete archive before writing,
and reconciles retained session counts after duplicate-safe event insertion. The renderer receives
only archive summaries and never arbitrary filesystem capabilities.

## Package responsibilities

- `apps/desktop`: Electron main, preload, React renderer, local persistence, and connection server.
- `apps/example-react-native`: runnable Expo integration example.
- `apps/example-react-native-cli`: bare React Native Community CLI integration example with committed native projects.
- `packages/protocol`: message types, schemas, negotiation, and JSON decoding boundary.
- `packages/sdk`: development-only transport client and event queue.
- `packages/shared`: runtime-neutral IDs and recursive redaction.
- `packages/sdk`: Single-entry React Native client, Redux/RTK middleware, navigation tracking,
  storage adapters, instrumentation, and the bundled client-side protocol runtime.

## Data flow

```text
React Native SDK
  → batch + redact + sequence
  → ws://127.0.0.1:9090 or authenticated wss://<trusted-host>:9090
  → parse JSON as unknown
  → Zod protocol validation + negotiation
  → SQLite transaction + in-memory session projection
  → validated Electron IPC snapshot
  → Zustand renderer store
  → unified timeline and details panel
```

## Session model

The SDK creates a device ID and session ID when configured. A connection ID represents one WebSocket lifetime. Reconnection preserves device/session identity for that configured client and receives a new connection ID.
