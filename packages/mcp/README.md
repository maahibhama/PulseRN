# PulseRN MCP

`pulsern-mcp` exposes the running PulseRN desktop debugger to local MCP clients over stdio.

Enable **MCP access** in PulseRN Settings, then configure an MCP client to launch the
`pulsern-mcp` binary. Set `PULSERN_MCP_CLIENT` to a human-readable client name for the audit log.

The server has full debugger and storage control. Only enable it for MCP clients you trust.
