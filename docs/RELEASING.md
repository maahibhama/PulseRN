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

# SDK releases

The React Native SDK is published independently from desktop releases. All SDK functionality is
available through the single `@pulse-rn/sdk` package entry point.

Before the first release, create or claim the `@pulse-rn` npm scope and configure npm Trusted
Publishing for the `maahibhama/PulseRN` repository, the `release-sdk.yml` workflow, and the `npm`
GitHub environment.

Prepare, validate, commit, tag, and push a release with one command:

```bash
pnpm release:sdk 0.2.1
```

The script requires a clean working tree, updates the package and runtime SDK versions, refreshes the
lockfile, validates the packed npm artifact, runs repository checks, creates the release commit, and
pushes the current branch and `sdk-vX.Y.Z` tag.

Preview without changing anything:

```bash
pnpm release:sdk 0.2.1 --dry-run
```

To recover a tag that failed before its npm version was published:

```bash
pnpm release:sdk 0.2.1 --replace-tag
```

Tag replacement is rejected if that version already exists on npm. Use `--yes` for a non-interactive
run and reserve `--skip-checks` for emergencies because the packed-package validator always runs.

Stable tags publish to npm's `latest` channel. Tags containing a prerelease suffix, such as
`sdk-v0.2.0-beta.1`, publish to `next`. The workflow rejects a tag that does not exactly match the
SDK package version or a tarball that leaks internal workspace packages.
