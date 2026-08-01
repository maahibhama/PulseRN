# Desktop installation

PulseRN publishes desktop applications through
[GitHub Releases](https://github.com/maahibhama/PulseRN/releases). Every release includes a
`SHA256SUMS.txt` file for artifact verification.

> Preview releases are unsigned. macOS Gatekeeper and Windows SmartScreen warnings are expected.
> Signed and notarized packages are planned before the stable release.

Unsigned preview builds deliberately disable automatic installation. Use GitHub Releases or
Homebrew to upgrade them. Once maintainers activate the documented signing secrets, eligible
packaged builds expose update checks and confirmed installation under **Settings → Software
updates**.

## Homebrew

Add the repository as a custom tap and install the Cask without quarantine:

```bash
brew tap maahibhama/pulsern https://github.com/maahibhama/PulseRN
brew install --cask --no-quarantine pulsern
```

Upgrade or uninstall:

```bash
brew update
brew upgrade --cask pulsern
brew uninstall --cask pulsern
brew untap maahibhama/pulsern
```

Use `brew uninstall --cask --zap pulsern` to also remove PulseRN settings and its local event
database.

## macOS DMG

1. Download the DMG matching the Mac:
   - `PulseRN-<version>-mac-arm64.dmg` for Apple Silicon (M1 and newer).
   - `PulseRN-<version>-mac-x64.dmg` for Intel.
2. Open the DMG and drag `PulseRN.app` to Applications.
3. Right-click PulseRN and choose **Open** the first time if Gatekeeper blocks the unsigned preview.

Remove PulseRN by moving it from Applications to Trash. Its local settings and event database remain under
`~/Library/Application Support/PulseRN` unless removed manually.

## Windows

Download the installer matching the computer:

- `PulseRN-<version>-windows-x64-setup.exe` for standard Intel/AMD Windows.
- `PulseRN-<version>-windows-arm64-setup.exe` for Windows on ARM.

Run the assisted installer and choose an installation directory. For this unsigned preview,
SmartScreen may require **More info → Run anyway**. Uninstall PulseRN from **Settings → Apps →
Installed apps**.

## Linux

For a portable installation:

```bash
chmod +x PulseRN-<version>-linux-x64.AppImage
./PulseRN-<version>-linux-x64.AppImage
```

Remove the AppImage file to uninstall it.

On Debian or Ubuntu:

```bash
sudo apt install ./PulseRN-<version>-linux-x64.deb
sudo apt remove pulsern
```

Linux packages currently target x86-64. Linux ARM packages are planned for a later release.

## Verify a download

Download `SHA256SUMS.txt` beside the installer, then run:

```bash
sha256sum --check SHA256SUMS.txt
```

On macOS:

```bash
shasum --algorithm 256 --check SHA256SUMS.txt
```

The checksum file covers all five desktop artifacts, so tools report missing files when only one
installer was downloaded. The checksum for the downloaded installer must report `OK`.

## Connecting an application

PulseRN listens on port `9090`. Use `127.0.0.1` from an iOS Simulator, `10.0.2.2` from an Android
Emulator, or reverse the port for an attached Android device:

```bash
adb reverse tcp:9090 tcp:9090
```
