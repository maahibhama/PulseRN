# Security policy

## Reporting

Please report vulnerabilities privately to the repository maintainers. Do not open a public issue containing an exploit, secret, or captured session.

## Current posture

- WebSocket listens only on `127.0.0.1` unless authenticated LAN access is explicitly enabled.
- LAN mode binds to `0.0.0.0` and requires a generated 256-bit access token in the validated
  handshake. Tokens are stored separately with user-only permissions and compared in constant time.
- TLS can be enabled with a user-supplied PEM certificate and matching private key. PulseRN validates
  the pair before use, stores both with user-only permissions, exposes certificate metadata rather
  than key material to the renderer, and serves the same validated protocol over `wss://`.
- TLS does not replace LAN token authentication. Without TLS, LAN transport is plain `ws://` and
  must only be used on trusted development networks because network observers can capture traffic
  and tokens.
- PulseRN does not provision trust on mobile devices. The device must trust the issuing certificate
  authority and the certificate's subject alternative names must cover the configured hostname or
  IP address.
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
- Desktop update operations stay in Electron main. Development and unsigned preview packages cannot
  invoke the updater. Enabled builds use generated SHA-512 release metadata, disable automatic
  downloads and install-on-quit, expose only validated status through preload, and require native
  confirmation before restart/install.
- Signed CI builds fail when configured signing credentials do not produce valid macOS or Windows
  signatures. Certificates, private keys, and notarization credentials belong only in GitHub Actions
  secrets and must never be committed.

Do not expose the LAN port to the public internet. Rotate the token after sharing it, when a device
is lost, or after using an untrusted network. Protect and rotate the TLS private key separately.
Prefer USB port forwarding or simulator loopback whenever possible.
