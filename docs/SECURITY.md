# Security policy

## Reporting

Please report vulnerabilities privately to the repository maintainers. Do not open a public issue containing an exploit, secret, or captured session.

## Current posture

- WebSocket listens only on `127.0.0.1` unless authenticated LAN access is explicitly enabled.
- LAN mode binds to `0.0.0.0` and requires a generated 256-bit access token in the validated
  handshake. Tokens are stored separately with user-only permissions and compared in constant time.
- LAN transport is plain `ws://` and must only be used on trusted development networks. It does not
  protect captured traffic or tokens from network observers.
- Renderer uses `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Preload exposes narrow validated operations, not raw Electron IPC or Node APIs.
- Network and IPC messages are treated as unknown and validated.
- Desktop preference reads and updates use a fixed schema; settings are stored with user-only file
  permissions under Electron `userData`.
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

Do not expose the LAN port to the public internet. Rotate the token after sharing it, when a device is
lost, or after using an untrusted network. Prefer USB port forwarding or simulator loopback whenever
possible.
