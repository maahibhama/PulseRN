# Protocol

Protocol version: `1.0.0`.

Clients first send `client-hello` with supported versions, stable IDs, app metadata, and device metadata. The server responds with `server-hello`. Event batches are rejected until negotiation succeeds.

Every event contains an ID, negotiated protocol version, session/device/app IDs, wall-clock timestamp, monotonic sequence within the client session, category, type, and JSON payload. Optional `correlationId` and `parentId` fields support the future unified timeline.

Console events use types `console.log`, `console.info`, `console.warn`, `console.error`, and `console.debug`. Their payload includes a validated level, JSON-safe arguments, display message, and optional stack/source location.

Network events use type `network.request`. Each completed payload contains a request ID, transport, method, redacted URL/query/headers, optional bounded bodies, status, start/end timestamps, duration, and optional error. Binary bodies are excluded.

Redux events use type `redux.action`. Their payload contains a store ID, action type and sanitized
action, optional previous/next state snapshots, optional path-based state diffs, and reducer duration.

Navigation events use `navigation.ready`, `navigation.state`, `navigation.focus`, or
`navigation.blur`. Payloads identify the navigator and integration source, lifecycle/action,
sanitized previous/current routes, and optional time spent on the previous route.

Performance events use `performance.<metric>`. Payloads contain a metric/name, non-negative value,
unit, explicit approximation flag, optional monotonic start/end values, and optional JSON metadata.
Approximate JavaScript FPS, timer-derived event-loop lag/stalls, startup and screen milestones,
custom measures, and runtime-exposed heap samples share this contract.

Limits in Phase 1:

- WebSocket frame: 2 MiB
- Event batch: 500 events
- Default SDK event payload: 256 KiB
- Default queue: 5,000 events
- Handshake timeout: 5 seconds

Invalid JSON or schema-invalid data is ignored and logged by Electron main; it never reaches the renderer or crashes the server.
