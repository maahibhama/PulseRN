# Local web debugger

Run PulseRN's browser edition without installing the Electron application:

```bash
npx @maahibhama/pulsern
```

The CLI requires Node.js 22.5 or newer because it reuses PulseRN's built-in SQLite implementation.

The CLI runs in the foreground, opens the browser, and prints the addresses for the browser, React
Native SDK, Android emulator, physical devices, and Metro. Stop it with `Ctrl+C`.

## Installation

Run the published package without a permanent installation:

```bash
npx @maahibhama/pulsern
```

Homebrew can install Node and the CLI together:

```bash
brew install maahibhama/pulsern/pulsern-cli
pulsern
```

To manage Node separately with Homebrew:

```bash
brew install node
npx @maahibhama/pulsern
```

Contributors working from a repository checkout use:

```bash
pnpm install
pnpm dev:web
```

The `pnpm dev:web` command builds from source and is not intended for end users.

## Connections

- Browser UI: `http://localhost:3000`
- SDK loopback and iOS simulator: `ws://127.0.0.1:9090`
- Android emulator: `ws://10.0.2.2:9090`
- Physical device: use the computer's IPv4 LAN address printed by the CLI
- Metro/Hermes: `http://127.0.0.1:8081`

The SDK listener remains loopback-only until **Allow LAN connections** is enabled. LAN clients must
complete the existing pairing flow. Plain `ws://` LAN traffic is not encrypted; use PulseRN TLS on
networks you do not fully trust.

## Options

```text
--port <number>          Browser/API port; default 3000
--sdk-port <number>      SDK ingestion port; default 9090
--metro-host <hostname>  Metro host; default 127.0.0.1
--metro-port <number>    Metro port; default 8081
--host <address>         Browser bind address; default 127.0.0.1
--data-dir <path>        Override persistent data directory
--no-open                Do not open the browser
--reset-browser-token    Revoke browser sessions
```

The browser endpoint binds to loopback by default. Passing `--host 0.0.0.0` exposes it to the local
network and should only be used on a trusted development network.

The CLI never silently changes a busy port. Stop the conflicting process or select a browser port
with `--port`; select the SDK port with `--sdk-port` and configure the React Native client to match.

## Persistence and updates

SQLite history, settings, trusted devices, themes, fonts, and TLS credentials are stored in the
platform-specific PulseRN web data directory printed at startup. Electron and web data directories
are intentionally separate; use `.pulsern` session archives to move history between them.

`npx @maahibhama/pulsern@latest` runs the newest published CLI release. Electron's native updater and
launch-at-login settings are intentionally hidden in the browser edition.

Each `cli-vX.Y.Z` GitHub Release also includes the exact npm tarball and `SHA256SUMS.txt` for manual
verification.
