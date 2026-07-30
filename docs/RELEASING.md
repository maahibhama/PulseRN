# Desktop releases

Desktop releases are built only from version tags. GitHub Actions creates separate macOS Apple
Silicon and Intel DMGs, Windows x64 and ARM64 NSIS installers, Linux x64 AppImage and Debian
packages, and a checksum file.

## Prepare a release

Use the release script from a clean working tree:

```bash
pnpm release:desktop 0.1.0
```

The script updates the root package, desktop package, and Homebrew Cask versions; runs typecheck,
tests, lint, and build; creates a release preparation commit when necessary; pushes the current
branch; and creates and pushes the annotated version tag.

Preview its actions without changing files or Git:

```bash
pnpm release:desktop 0.1.0 --dry-run
```

For automation, bypass the confirmation with `--yes`. Use `--skip-checks` only when the exact commit
has already passed the complete verification suite:

```bash
pnpm release:desktop 0.1.0 --yes --skip-checks
```

Use a tag such as `v0.2.0-beta.1` for a GitHub prerelease. The workflow rejects malformed tags and
any mismatch between the tag, package versions, and Homebrew Cask version.

## Artifacts

Stable artifact names are part of the release interface:

```text
PulseRN-<version>-mac-arm64.dmg
PulseRN-<version>-mac-x64.dmg
PulseRN-<version>-windows-x64-setup.exe
PulseRN-<version>-windows-arm64-setup.exe
PulseRN-<version>-linux-x64.AppImage
PulseRN-<version>-linux-x64.deb
SHA256SUMS.txt
```

The publishing job runs only after verification and every platform package succeeds. It confirms
the complete artifact set before creating the GitHub Release.

## Local packaging

Build an unpacked application for smoke testing:

```bash
pnpm pack:desktop
```

Build an installer on the current platform:

```bash
pnpm dist:mac
pnpm dist:win:x64
pnpm dist:win:arm64
pnpm dist:linux
```

macOS and Windows output is intentionally unsigned in the preview phase. Do not enable automatic
updates until Apple Developer ID notarization and Windows code-signing secrets are configured.
