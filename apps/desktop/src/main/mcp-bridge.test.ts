import { readFileSync, rmSync, statSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PulseRNAccessFile, PulseRNBridgeResponse } from '@pulse-rn/mcp';
import { EventDatabase } from './database.js';
import { McpBridge } from './mcp-bridge.js';
import type { DebuggerManager } from './debugger-manager.js';
import { SessionManager } from './session-manager.js';
import type { DevToolWebSocketServer } from './websocket-server.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function send(
  socketPath: string,
  request: Record<string, unknown>,
): Promise<PulseRNBridgeResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      socket.end();
      resolve(JSON.parse(buffer.slice(0, newline)) as PulseRNBridgeResponse);
    });
    socket.once('error', reject);
  });
}

describe('McpBridge', () => {
  it('requires its generated token and removes access on stop', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-mcp-'));
    directories.push(directory);
    const database = new EventDatabase(join(directory, 'events.sqlite'));
    const bridge = new McpBridge(directory, {
      database: () => database,
      debugger: () => ({}) as DebuggerManager,
      sessions: new SessionManager(),
      server: () => ({}) as DevToolWebSocketServer,
    });

    await bridge.start();
    const access = JSON.parse(readFileSync(bridge.accessFilePath, 'utf8')) as PulseRNAccessFile;
    if (process.platform !== 'win32') {
      expect(statSync(bridge.accessFilePath).mode & 0o777).toBe(0o600);
      expect(statSync(bridge.socketPath).mode & 0o777).toBe(0o600);
    }

    const valid = await send(access.socketPath, {
      id: crypto.randomUUID(),
      token: access.token,
      client: 'test-client',
      tool: 'pulsern_list_sessions',
      arguments: {},
    });
    expect(valid.error).toBeUndefined();
    expect(valid.result).toEqual([]);
    expect(bridge.clientSnapshot()).toMatchObject([
      {
        name: 'test-client',
        requestCount: 1,
      },
    ]);

    const invalid = await send(access.socketPath, {
      id: crypto.randomUUID(),
      token: 'x'.repeat(64),
      client: 'test-client',
      tool: 'pulsern_list_sessions',
      arguments: {},
    });
    expect(invalid.error?.message).toContain('authentication');

    await bridge.stop();
    expect(bridge.clientSnapshot()).toEqual([]);
    expect(() => readFileSync(bridge.accessFilePath)).toThrow();
    database.close();
  });
});
