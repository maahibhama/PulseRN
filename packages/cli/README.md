# PulseRN CLI

Run the PulseRN debugger locally with Node.js 22.5 or newer, without installing the Electron
application:

```bash
npx pulsern
```

PulseRN opens `http://localhost:3000`, listens for the React Native SDK on port `9090`, and stores
debugger history in the platform-specific application data directory. Run `npx pulsern --help` for
configuration options.
