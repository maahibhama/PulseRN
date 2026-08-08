# Anonymous usage analytics

PulseRN is local-first. Anonymous usage analytics are disabled by default and no request is made
until the user explicitly opts in. Consent can be changed under **Settings → Privacy**, or for the
CLI with `--telemetry=on|off` / `PULSERN_TELEMETRY=on|off`.

The analytics provider is PostHog. Release builds enable delivery only when a public
`PULSERN_POSTHOG_KEY` is configured. Disabling analytics deletes the random local installation
identifier. Captured debugging events remain local regardless of analytics consent.

Desktop release builds embed the public project key from the `PULSERN_POSTHOG_KEY` Actions secret
and optional `PULSERN_POSTHOG_HOST` repository variable. The CLI reads the same names at runtime.
When the key is absent, consent can still be recorded locally but no analytics request is sent.

## Allowlisted events

- `install_started`, `onboarding_opened`, `demo_opened`, `sdk_instructions_copied`
- `first_app_connected`, `first_event_persisted`, `native_capture_started`
- `weekly_active`, `release_update_checked`

Allowed properties are a random analytics installation UUID, PulseRN version, desktop/CLI
distribution, operating-system family, CPU architecture, consent schema version, SDK and React
Native versions when available, and a coarse `success`, `unavailable`, or `error` reason.

PulseRN never sends logs, URLs, headers, bodies, Redux data, storage values, source paths, bundle or
application identifiers, device identifiers, IP-derived location, pairing credentials, archive
contents, or MCP prompts. PostHog person profiles and GeoIP enrichment are disabled. The client
rejects event names and properties outside its fixed schema.

Project maintainers should configure the shortest practical provider retention and use aggregate
funnels only. Analytics exports must not be joined with captured PulseRN sessions.
