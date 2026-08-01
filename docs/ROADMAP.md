# Roadmap

- **Phase 1 — Foundation (complete):** monorepo, secure Electron shell, protocol, WebSocket transport, SDK, sessions, SQLite, example, initial UI.
- **Phase 2 — Console (complete):** safe console interception, serialization, stacks, filtering, search, pause, clear, payload expansion, and copy.
- **Phase 3 — Network (complete):** fetch/XHR/Axios instrumentation, redaction, binary exclusion, truncation, timing, filtering, failure highlighting, and inspector tabs.
- **Phase 4 — Redux (complete):** Redux/RTK middleware, action/state/diff capture, timing, redaction, filters, multiple stores.
- **Phase 5 — Navigation (complete):** React Navigation integration, lifecycle events, nested route resolution, timing, redacted parameters, manual API.
- **Phase 6 — Performance (complete):** approximate JS FPS/lag/stalls, startup and screen timing, optional JS heap samples, custom marks, correlated dashboards.
- **Phase 7 — Storage (complete):** AsyncStorage/provider discovery, key read/search/refresh, JSON redaction, confirmed mutations, extensible provider API.
- **Phase 8 — Errors (complete):** global errors, rejection/error-boundary capture, stacks, active-screen attribution, network/SDK failures, and the previous 20 timeline events.
- **Phase 9 — JavaScript debugger (complete):** Hermes target discovery through Metro, original sources and source maps, breakpoints, pause/resume, line stepping, call stacks, scopes, watches, expression evaluation, and exception pausing.
- **Phase 10 — Scalable foundation (complete):** ordered transactional SQLite migrations with explicit history, persisted device/session/retention metadata, integrity backup and recovery reporting, forward/backward cursor queries, 2,000-event renderer windows, virtualization across every event inspector, transport health and backpressure diagnostics, a 100,000-event performance profile, and Electron acceptance coverage.
- **Phase 11 — Connections, sessions, and secure pairing (complete):** connection center diagnostics, persisted session lifecycle controls, one-time LAN pairing with bounded expiry and retries, hashed reconnect credentials, per-device revocation, host/origin validation, TLS integration, trust state, and disconnect history.
- **Phase 12 — Unified timeline (complete):** indexed database filters, saved views, bookmarks, annotations, keyboard navigation, Follow Latest, parent/correlation links, renderer-only clearing, confirmed permanent deletion, and compressed checksummed transactional archives.
- **Phase 13 — Console (complete):** consecutive repeat collapsing with session boundaries and timestamp ranges, lazy structured arguments, multiline message/stack search, source grouping and links, level presets, redaction/truncation indicators, configurable SDK capture and renderer display limits, and console-specific transport drop diagnostics.
- **Phase 14 — Network (complete):** backward-compatible lifecycle events, in-flight progress and redirects, waterfall timing with explicit accuracy, initiators and request correlations, lazy payload/header/query views, sanitized cURL/HAR export, binary exclusion, redaction, and bounded per-body/request/session capture.
- **Phase 15 — Redux (complete):** bounded lazy action/state trees, searchable diffs and changed-path summaries, state-size warnings, circular/oversized state handling, per-store categories and action allow/deny policies, and optional route/request/error/performance correlations while remaining read-only.
- **Phase 16 — Navigation (complete):** normalized React Navigation, Expo Router, and manual history; complete route paths; flat nested ownership trees with stable navigator IDs; screen-duration charts; parameter diffs; grouped actions; duplicate/incomplete/ancestry warnings; retained integration metadata; and request/Redux/performance/console/error correlation links.
- **Phase 17 — Performance (complete):** bounded virtualized time-series inspection with selectable ranges, configurable JS FPS/stall/slow-screen/network/memory-growth thresholds, matching-session baselines, SDK sampling interval/loss/capture-rate visibility, explicit JavaScript/runtime provenance, and honest unavailable capability reporting without fake native metrics.
- **Phase 18 — Storage (next):** paginated keys, typed editors, snapshots, local mutation backups, single-session undo, audits, and safe export.
- **Phase 19 — Errors:** stable fingerprints, grouping, regression state, symbolication, correlations, classification, and sanitized issue reports.
- **Phase 20 — JavaScript debugger:** resilient Metro/CDP negotiation, reconnects, source hierarchy, lazy variables, inline values, advanced breakpoints, and restored TypeScript debugging.
- **Phase 21 — Settings, accessibility, and onboarding:** organized settings, first-run diagnostics, keyboard and screen-reader access, contrast, reduced motion, and version branding.
- **Phase 22 — SDK and integration experience:** stable identities, typed diagnostics/configuration, sampling and budgets, lazy optional integrations, consumer-package tests, and deterministic examples.
- **Phase 23 — Distribution and open-source readiness:** signed installers and updates, release verification, checksums, SBOMs, provenance, compatibility/support policy, automation, and screenshots.

Work proceeds in order. Existing archive, LAN token, TLS, packaging, and updater implementations are
frozen until their assigned production-readiness phase and do not make those phases complete.
