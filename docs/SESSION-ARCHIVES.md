# Session archives

PulseRN can move retained debugging history between desktop installations through the **Sessions**
view. Export one session or all listed sessions; import uses a native file picker.

Archives are UTF-8 JSON with the format identifier `pulse-rn-session` and version `1`. Each archive
contains:

- export timestamp;
- validated session metadata;
- validated PulseRN event envelopes belonging to those sessions.

Import is limited to 100 MiB. Electron main parses and validates the complete archive before changing
SQLite. Unknown versions, malformed events, undeclared session references, and oversized files are
rejected. Event IDs remain unique, so importing the same archive more than once does not duplicate
events. Session event counts are recalculated after restoration, and normal retention settings run
immediately.

Archives can contain captured application data. Review them before sharing, store them according to
your project's security policy, and never commit production captures or secrets.
