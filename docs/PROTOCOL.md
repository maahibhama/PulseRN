# Protocol

Protocol version: `1.0.0`.

Clients first send `client-hello` with supported versions, stable IDs, app metadata, and device metadata. The server responds with `server-hello`. Event batches are rejected until negotiation succeeds.

Every event contains an ID, negotiated protocol version, session/device/app IDs, wall-clock timestamp, monotonic sequence within the client session, category, type, and JSON payload. Optional `correlationId` and `parentId` fields support the future unified timeline.

Limits in Phase 1:

- WebSocket frame: 2 MiB
- Event batch: 500 events
- Default SDK event payload: 256 KiB
- Default queue: 5,000 events
- Handshake timeout: 5 seconds

Invalid JSON or schema-invalid data is ignored and logged by Electron main; it never reaches the renderer or crashes the server.
