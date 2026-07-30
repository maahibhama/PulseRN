# Desktop releases

Desktop releases are built only from version tags. GitHub Actions creates a macOS universal DMG,
Windows x64 and ARM64 NSIS installers, Linux x64 AppImage and Debian packages, and a checksum file.

## Prepare a release

1. Update the same semantic version in:
   - `package.json`
   - `apps/desktop/package.json`
   - `Casks/pulsern.rb`
2. Update the changelog or release-facing documentation.
3. Install and verify the repository:

   ```bash
   pnpm install --frozen-lockfile
   pnpm release:verify v0.1.0
   pnpm typecheck
   pnpm test
   pnpm lint
   pnpm build
   ```

4. Commit the release preparation.
5. Create and push the matching tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

Use a tag such as `v0.2.0-beta.1` for a GitHub prerelease. The workflow rejects malformed tags and
any mismatch between the tag, package versions, and Homebrew Cask version.

## Artifacts

Stable artifact names are part of the release interface:

```text
PulseRN-<version>-mac-universal.dmg
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
