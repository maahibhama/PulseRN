# Protocol

Protocol version: `1.0.0`.

Clients first send `client-hello` with supported versions, stable IDs, app metadata, and device
metadata. The server responds with `server-hello` and optional capabilities. Event batches are
rejected until negotiation succeeds.

Authenticated LAN mode requires either a short-lived `client-hello.pairingCode` or a previously
issued `client-hello.reconnectToken`. Pairing codes are single-use, expire after five minutes, and
allow at most five failed attempts. A successful pairing returns a reconnect token once in
`server-hello`; PulseRN stores only its SHA-256 hash. Missing, expired, revoked, or invalid
credentials receive a rejected `server-hello` before the device session is created. Loopback mode
does not require credentials.

The JSON messages and negotiation are identical over `ws://` and `wss://`. TLS is a transport-layer
desktop preference and adds no protocol field. SDK clients select `wss://` with `secure: true`; LAN
clients still pair or send a reconnect token.

Desktops advertising the `client-health` capability accept bounded `client-health` reports with
queue depth, categorized drops, sent counts, reconnect attempts, native WebSocket buffer size, and
approximate clock offset. New SDKs do not send these reports to older desktops that omit the
capability.

Every event contains an ID, negotiated protocol version, session/device/app IDs, wall-clock timestamp, monotonic sequence within the client session, category, type, and JSON payload. Optional `correlationId` and `parentId` fields support the future unified timeline.

Console events use types `console.log`, `console.info`, `console.warn`, `console.error`, and
`console.debug`. Their payload includes a validated level, JSON-safe arguments, display message,
optional stack/source location, and optional additive `redacted` and `truncated` indicators. Client
health may include additive `consoleDroppedEvents` diagnostics. Existing protocol v1 readers can
ignore all three optional fields.

Completed network events continue to use type `network.request`. Each completed payload contains a
request ID, transport, method, redacted URL/query/headers, optional bounded bodies, status,
start/end timestamps, duration, explicit measured/approximate timing accuracy, optional initiator
and redirect chain, capture-budget metadata, and optional error. Binary bodies are excluded.

New clients may add `network.request-start`, `network.request-progress`,
`network.request-redirect`, `network.request-complete`, and `network.request-failure`. Their bounded
lifecycle payloads share a request ID with the completed event and carry only the fields available
at that phase. Older desktops can ignore these additive types and continue reading
`network.request`; newer desktops combine both formats into a live request model.

Redux events use type `redux.action`. Their payload contains a store ID, action type and sanitized
action, optional bounded previous/next state snapshots, path-based diffs and changed-path summaries,
state-size/truncation metadata, optional action category and cross-inspector correlations, and
reducer duration. All Phase 15 fields are additive for existing protocol v1 readers.

Navigation events use `navigation.ready`, `navigation.state`, `navigation.focus`, or
`navigation.blur`. Payloads identify the navigator and integration source, lifecycle/action,
sanitized previous/current routes, and optional time spent on the previous route. Additive Phase 16
fields provide a normalized complete route path, flat nested-navigator ownership tree, parameter
diffs, grouped actions, integration metadata, tracking-quality warnings, and cross-inspector
correlations.

Performance events use `performance.<metric>`. Payloads contain a metric/name, non-negative value,
unit, explicit approximation flag, optional monotonic start/end values, and optional JSON metadata.
Approximate JavaScript FPS, timer-derived event-loop lag/stalls, startup and screen milestones,
custom measures, and runtime-exposed heap samples share this contract. Additive sampling metadata
reports interval, loss, and capture rate; provenance distinguishes JavaScript-derived and runtime
values. Capability events explicitly report available/unavailable animation-frame, JS-heap, native
CPU, UI-thread, and native-memory support without substituting values.

Storage inspection adds a validated request/response channel. Electron sends `storage-command`
messages for provider discovery, list, get, set, or delete; the SDK responds with a matching
`storage-result`. Requests carry bounded IDs/keys/values, time out on the desktop, and are tied to
one connected device. `storage.<operation>` audit events enter the unified timeline without
including stored values.

Error events use `error.<source>`. Their validated payload contains source, name, message, optional
JavaScript/component stacks, fatality, active screen, metadata, and at most 20 preceding timeline
event summaries. Sources are `uncaught`, `unhandled_rejection`, `react_boundary`, `network`,
`sdk_internal`, and `manual`.

Limits in Phase 1:

- WebSocket frame: 2 MiB
- Event batch: 500 events
- Default SDK event payload: 256 KiB
- Default queue: 5,000 events
- Default socket backpressure threshold: 1 MiB
- Default health interval: 2 seconds
- Handshake timeout: 5 seconds

Invalid JSON or schema-invalid data is ignored and logged by Electron main; it never reaches the renderer or crashes the server.

Desktop persistence is outside the device protocol. Validated preload queries accept one category or
a bounded category list, allowing every inspector to page its retained SQLite history independently.
