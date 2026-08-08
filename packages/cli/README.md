# PulseRN CLI

Run the PulseRN debugger locally with Node.js 22.5 or newer, without installing the Electron
application:

```bash
npx @maahibhama/pulsern
```

On macOS, install the CLI and a compatible Node runtime with Homebrew:

```bash
brew tap maahibhama/pulsern https://github.com/maahibhama/PulseRN
brew install maahibhama/pulsern/pulsern-cli
pulsern
```

PulseRN opens `http://localhost:3000`, listens for the React Native SDK on port `9090`, and stores
debugger history in the platform-specific application data directory. Keep the terminal open and
press `Ctrl+C` to stop. Run `pulsern --help` (Homebrew) or
`npx @maahibhama/pulsern --help` (npx) for configuration options.
