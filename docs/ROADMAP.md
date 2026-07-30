# Roadmap

- **Phase 1 — Foundation (complete):** monorepo, secure Electron shell, protocol, WebSocket transport, SDK, sessions, SQLite, example, initial UI.
- **Phase 2 — Console (complete):** safe console interception, serialization, stacks, filtering, search, pause, clear, payload expansion, and copy.
- **Phase 3 — Network (complete):** fetch/XHR/Axios instrumentation, redaction, binary exclusion, truncation, timing, filtering, failure highlighting, and inspector tabs.
- **Phase 4 — Redux (complete):** Redux/RTK middleware, action/state/diff capture, timing, redaction, filters, multiple stores.
- **Phase 5 — Navigation (complete):** React Navigation integration, lifecycle events, nested route resolution, timing, redacted parameters, manual API.
- **Phase 6 — Performance (complete):** approximate JS FPS/lag/stalls, startup and screen timing, optional JS heap samples, custom marks, correlated dashboards.
- **Phase 7 — Storage:** AsyncStorage read/search and confirmed mutations; extensible storage provider API.
- **Phase 8 — Errors:** global errors, rejection/error-boundary capture, stacks, and previous-event context.

Before high-volume phases, harden the foundation with database pagination, renderer virtualization, authenticated optional LAN binding, SDK identity persistence, and Electron end-to-end coverage.
