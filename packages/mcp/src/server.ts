#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import {
  MCP_PROTOCOL_VERSION,
  PULSERN_MCP_TOOLS,
  type PulseRNAccessFile,
  type PulseRNBridgeRequest,
  type PulseRNBridgeResponse,
} from './index.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

function accessFilePath(): string {
  if (process.env['PULSERN_MCP_ACCESS_FILE']) return process.env['PULSERN_MCP_ACCESS_FILE'];
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'PulseRN', 'mcp-access.json');
  }
  if (platform() === 'win32') {
    return join(
      process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'),
      'PulseRN',
      'mcp-access.json',
    );
  }
  return join(
    process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'),
    'PulseRN',
    'mcp-access.json',
  );
}

async function callBridge(tool: string, args: Record<string, unknown>): Promise<unknown> {
  let access: PulseRNAccessFile;
  try {
    access = JSON.parse(await readFile(accessFilePath(), 'utf8')) as PulseRNAccessFile;
  } catch {
    throw new Error('PulseRN MCP is unavailable. Open PulseRN and enable MCP access in Settings.');
  }
  return new Promise((resolve, reject) => {
    const socket = createConnection(access.socketPath);
    let buffer = '';
    const request: PulseRNBridgeRequest = {
      id: randomUUID(),
      token: access.token,
      client: process.env['PULSERN_MCP_CLIENT']?.slice(0, 128) || 'MCP client',
      tool,
      arguments: args,
    };
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('PulseRN MCP request timed out.'));
    }, 15_000);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 2 * 1024 * 1024)
        socket.destroy(new Error('PulseRN response is too large.'));
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      const response = JSON.parse(buffer.slice(0, newline)) as PulseRNBridgeResponse;
      socket.end();
      if (response.error) reject(new Error(response.error.message));
      else resolve(response.result);
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function handle(request: JsonRpcRequest): Promise<void> {
  if (request.id === undefined) return;
  try {
    let result: unknown;
    switch (request.method) {
      case 'initialize':
        result = {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'pulsern-mcp', version: '0.1.0' },
        };
        break;
      case 'ping':
        result = {};
        break;
      case 'tools/list':
        result = { tools: PULSERN_MCP_TOOLS };
        break;
      case 'tools/call': {
        const name = String(request.params?.['name'] ?? '');
        if (!PULSERN_MCP_TOOLS.some((tool) => tool.name === name)) {
          throw new Error(`Unknown PulseRN tool: ${name}`);
        }
        const args = (request.params?.['arguments'] ?? {}) as Record<string, unknown>;
        const value = await callBridge(name, args);
        result = {
          content: [
            { type: 'text', text: JSON.stringify({ untrusted: true, data: value }, null, 2) },
          ],
          structuredContent: { untrusted: true, data: value },
        };
        break;
      }
      case 'resources/list':
        result = {
          resources: [
            {
              uri: 'pulsern://sessions',
              name: 'PulseRN sessions',
              description: 'Recent local PulseRN debugging sessions.',
              mimeType: 'application/json',
            },
            {
              uri: 'pulsern://debugger/capabilities',
              name: 'PulseRN debugger capabilities',
              description: 'Current Hermes debugger status and capabilities.',
              mimeType: 'application/json',
            },
          ],
        };
        break;
      case 'resources/read': {
        const uri = request.params?.['uri'];
        const value =
          uri === 'pulsern://sessions'
            ? await callBridge('pulsern_list_sessions', {})
            : uri === 'pulsern://debugger/capabilities'
              ? await callBridge('pulsern_get_debugger_state', {})
              : undefined;
        if (value === undefined) throw new Error(`Unknown PulseRN resource: ${String(uri)}`);
        result = {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }],
        };
        break;
      }
      default:
        throw new Error(`Unsupported MCP method: ${request.method}`);
    }
    write({ jsonrpc: '2.0', id: request.id, result });
  } catch (error) {
    write({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
    });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf('\n');
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try {
      void handle(JSON.parse(line) as JsonRpcRequest);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
  }
});
