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
- **Phase 10 — Scalable foundation (complete):** versioned SQLite migrations, persisted session metadata, validated cursor-based event queries, a bounded virtualized Timeline, paginated inspector queries, configurable retention, malformed-record recovery, negotiated transport health, categorized drop accounting, native WebSocket backpressure protection, a 25,000-event sustained-load profile, and real Electron acceptance coverage.

Later phases add authenticated optional LAN binding, SDK identity persistence, per-inspector query
models, session import/export, and signed update delivery.
