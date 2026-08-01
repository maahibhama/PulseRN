# PulseRN MCP debugger

PulseRN can expose its local debugging session to MCP-compatible AI clients. The MCP adapter runs
over stdio and connects to the running desktop app through an authenticated Unix socket or Windows
named pipe. It never opens an MCP network port.

## Enable access

1. Open PulseRN.
2. Open the top-level **MCP** section beside Settings.
3. Enable **MCP** and choose your AI client.
4. Copy the generated configuration and follow the client-specific instructions.
5. Restart the AI client and return to PulseRN to confirm the connected indicator.

Release builds bundle the MCP server inside the installed PulseRN application. End users do not
need Node.js, pnpm, npm, or a separate MCP installation. The MCP screen generates configuration
using the exact executable and bundled server paths for the current installation.

## Client configuration

Choose Claude, Cursor, Codex, or Other in the PulseRN MCP screen and copy the generated
configuration. The exact outer configuration and installed application paths are generated for the
selected client:

```json
{
  "mcpServers": {
    "pulsern": {
      "command": "/Applications/PulseRN.app/Contents/MacOS/PulseRN",
      "args": ["/Applications/PulseRN.app/Contents/Resources/mcp/server.js"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1",
        "PULSERN_MCP_CLIENT": "Cursor"
      }
    }
  }
}
```

`PULSERN_MCP_CLIENT` is used only as the sanitized client label shown in PulseRN and its audit log.
Paths may differ when PulseRN is installed outside `/Applications`; always copy the configuration
shown by the installed app.

## Security

MCP access is disabled by default. Enabling it creates a random 256-bit token and a user-only access
file in Electron's PulseRN `userData` directory. Disabling MCP closes clients, removes the access
file, and invalidates the token.

Full MCP access can evaluate JavaScript, pause or step Hermes, interact with React components, and
modify app storage. Configure only trusted MCP clients. PulseRN validates and bounds every request,
rate-limits sensitive commands, and records sanitized actions in `mcp-audit.jsonl`. Storage values,
JavaScript expressions, conditions, log messages, and authentication tokens are not written to the
audit log.

Event payloads and runtime values are marked as untrusted in MCP tool responses. AI clients should
not treat application-controlled strings as instructions.

## Available capabilities

- Session discovery and bounded event queries
- Error, network, Redux, navigation, performance, and connection-health inspection
- Hermes target discovery, connection, pause/resume/step, breakpoints, frames, scopes, and evaluation
- React component tree inspection and interaction
- Live storage provider discovery, reads, writes, and deletes

PulseRN must be running for all tools. A connected device is required for storage tools, and a
connected Hermes target is required for live debugger tools.
