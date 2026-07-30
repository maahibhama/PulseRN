# Security policy

## Reporting

Please report vulnerabilities privately to the repository maintainers. Do not open a public issue containing an exploit, secret, or captured session.

## Phase 1 posture

- WebSocket listens only on `127.0.0.1`.
- Renderer uses `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Preload exposes two snapshot operations, not raw Electron IPC or Node APIs.
- Network and IPC messages are treated as unknown and validated.
- Frames, batches, queues, and event payloads are bounded.
- Sensitive object fields are redacted before queueing/transmission.
- Sensitive network headers and URL query parameters are redacted before transmission.
- Binary bodies are excluded and captured text/JSON bodies are size-limited.
- Redux actions and state snapshots are depth-bounded and configurable sensitive fields are redacted.
- Navigation parameters are depth-bounded and configurable sensitive fields are redacted.
- Custom performance metadata passes through the SDK's normal recursive field redaction.
- Storage commands are schema-validated, bounded, device-scoped, and time-limited.
- Storage updates and deletes require explicit desktop confirmation; redacted JSON cannot be updated.
- Storage audit events never contain stored values.
- Structured error metadata is field-redacted; context is derived from already-sanitized events,
  capped at 20 entries, and remains subject to payload limits. Applications should not embed secrets
  directly in arbitrary error-message or stack strings.
- No `eval`, remote content, navigation, or arbitrary window opening is allowed.

Do not bind the server to a LAN interface until authentication and origin controls are implemented.
