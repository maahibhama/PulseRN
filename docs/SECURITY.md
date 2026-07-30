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
- No `eval`, remote content, navigation, or arbitrary window opening is allowed.

Header and URL redaction configuration is accepted for forward compatibility but will only be applied when Phase 3 adds network interception. Do not bind the server to a LAN interface until authentication and origin controls are implemented.
