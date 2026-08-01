# Session archives

PulseRN can move retained debugging history between desktop installations through the **Sessions**
view. Export one session or all listed sessions; import uses a native file picker.

Archives use the `.pulsern` extension and contain gzip-compressed UTF-8 JSON with the format
identifier `pulse-rn-archive` and archive-format version `2`. Each archive contains:

- a manifest with export time, entry counts, archive version, and redaction metadata;
- validated session and device metadata;
- validated PulseRN event envelopes belonging to those sessions;
- bookmarks and annotations stored separately from immutable captured events;
- one SHA-256 checksum for every session, device, event, bookmark, and annotation entry.

Import is limited to a 100 MiB compressed file and a 512 MiB decompressed payload. Electron main
decompresses, parses, validates relationships, verifies every checksum, and validates manifest counts
before changing SQLite. Unknown versions, malformed events, undeclared session references, invalid
checksums, decompression bombs, and oversized files are rejected. Valid imports write sessions,
devices, events, bookmarks, and annotations in one transaction. Event IDs remain unique, so importing
the same archive more than once does not duplicate events. Session event counts are recalculated after
restoration, and normal retention settings run immediately.

Archives can contain captured application data. Review them before sharing, store them according to
your project's security policy, and never commit production captures or secrets.
