import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { DebuggerManager } from './debugger-manager.js';

interface Harness {
  http: Server;
  sockets: WebSocketServer;
  port: number;
  commands: { id: number; method: string; params?: Record<string, unknown> }[];
  socket?: WebSocket;
}

const harnesses: Harness[] = [];

async function createHarness(rejectDebugger = false): Promise<Harness> {
  const http = createServer();
  const sockets = new WebSocketServer({
    server: http,
    path: '/inspector/debug',
    verifyClient: ({ origin }: { origin: string }) => {
      if (rejectDebugger) return false;
      try {
        return new URL(origin).hostname === '127.0.0.1';
      } catch {
        return false;
      }
    },
  });
  const harness: Harness = { http, sockets, port: 0, commands: [] };
  harnesses.push(harness);
  sockets.on('connection', (socket) => {
    harness.socket = socket;
    socket.on('message', (raw) => {
      const command = JSON.parse(raw.toString()) as Harness['commands'][number];
      harness.commands.push(command);
      if (command.method === 'Debugger.getScriptSource') {
        socket.send(JSON.stringify({ id: command.id, result: { scriptSource: 'generated();' } }));
      } else if (command.method === 'Debugger.setAsyncCallStackDepth') {
        socket.send(
          JSON.stringify({
            id: command.id,
            error: {
              code: -32601,
              message: "Unsupported method 'Debugger.setAsyncCallStackDepth'",
            },
          }),
        );
      } else if (command.method === 'Debugger.setBreakpointByUrl') {
        socket.send(
          JSON.stringify({
            id: command.id,
            result: {
              breakpointId: 'breakpoint-1',
              locations: [{ scriptId: 'script-1', lineNumber: 0, columnNumber: 0 }],
            },
          }),
        );
      } else if (command.method === 'Runtime.getProperties') {
        socket.send(
          JSON.stringify({
            id: command.id,
            result: {
              result: [{ name: 'total', value: { type: 'number', value: 12, description: '12' } }],
            },
          }),
        );
      } else if (command.method === 'Debugger.evaluateOnCallFrame') {
        socket.send(
          JSON.stringify({
            id: command.id,
            result: { result: { type: 'number', value: 12, description: '12' } },
          }),
        );
      } else {
        socket.send(JSON.stringify({ id: command.id, result: {} }));
      }
      if (command.method === 'Debugger.enable') {
        const sourceMap = Buffer.from(
          JSON.stringify({
            version: 3,
            sources: ['[metro-project]/debugger-demo.ts'],
            names: [],
            mappings: 'AAAA',
          }),
        ).toString('base64');
        socket.send(
          JSON.stringify({
            method: 'Debugger.scriptParsed',
            params: {
              scriptId: 'script-1',
              url: `http://127.0.0.1:${harness.port}/index.bundle`,
              sourceMapURL: `data:application/json;base64,${sourceMap}`,
            },
          }),
        );
      }
    });
  });
  http.on('request', (request, response) => {
    if (request.url === '/json/list') {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify([
          {
            id: 'target-1',
            title: 'PulseRN Example',
            description: 'Hermes',
            webSocketDebuggerUrl: `ws://127.0.0.1:${harness.port}/inspector/debug`,
          },
          {
            id: 'remote-target',
            title: 'Rejected',
            webSocketDebuggerUrl: 'ws://example.com/inspector/debug',
          },
        ]),
      );
    } else if (request.url === '/[metro-project]/debugger-demo.ts') {
      response.end('export const total = 12;');
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  harness.port = (http.address() as { port: number }).port;
  return harness;
}

afterEach(async () => {
  await Promise.all(
    harnesses.splice(0).map(
      (harness) =>
        new Promise<void>((resolve) => {
          for (const client of harness.sockets.clients) client.terminate();
          harness.sockets.close();
          harness.http.closeAllConnections?.();
          harness.http.close();
          resolve();
        }),
    ),
  );
});

describe('DebuggerManager', () => {
  it('discovers loopback targets, maps sources, and drives a paused Hermes runtime', async () => {
    const harness = await createHarness();
    const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-debugger-'));
    const onState = vi.fn();
    const manager = new DebuggerManager(
      join(directory, 'debugger.json'),
      () => harness.port,
      onState,
    );

    const discovered = await manager.discover();
    expect(discovered.targets).toHaveLength(1);
    expect(discovered.targets[0]?.id).toBe('target-1');

    await manager.connect('target-1');
    await vi.waitFor(() => {
      expect(manager.snapshot().sources.some((source) => source.name === 'debugger-demo.ts')).toBe(
        true,
      );
    });
    const source = manager.snapshot().sources.find((entry) => entry.name === 'debugger-demo.ts')!;
    expect(await manager.getSource(source.id)).toContain('total = 12');

    await manager.addBreakpoint({
      sourceId: source.id,
      line: 1,
      column: 1,
      condition: 'total > 0',
      hitCondition: 2,
      logMessage: 'total reached',
    });
    expect(manager.snapshot().breakpoints[0]).toMatchObject({ verified: true, line: 1 });
    expect(
      harness.commands.some((command) => command.method === 'Debugger.setBreakpointByUrl'),
    ).toBe(true);
    expect(
      harness.commands.find((command) => command.method === 'Debugger.setBreakpointByUrl')?.params
        ?.condition,
    ).toContain('__pulseRNDebuggerHits');
    expect(
      harness.commands.find((command) => command.method === 'Debugger.setBreakpointByUrl')?.params
        ?.condition,
    ).toContain('[PulseRN logpoint] total reached');

    harness.socket!.send(
      JSON.stringify({
        method: 'Debugger.paused',
        params: {
          reason: 'other',
          hitBreakpoints: ['breakpoint-1'],
          callFrames: [
            {
              callFrameId: 'frame-1',
              functionName: 'calculateLineTotal',
              location: { scriptId: 'script-1', lineNumber: 0, columnNumber: 0 },
              scopeChain: [{ type: 'local', object: { type: 'object', objectId: 'scope-1' } }],
            },
          ],
        },
      }),
    );
    await vi.waitFor(() => expect(manager.snapshot().status).toBe('paused'));
    expect(manager.snapshot().breakpoints[0]?.hitCount).toBe(1);
    expect(manager.snapshot().callFrames[0]?.location).toMatchObject({
      sourceId: source.id,
      line: 1,
    });
    await manager.addWatch('total');
    expect(manager.snapshot().watches[0]?.result?.description).toBe('12');
    expect(await manager.getScope('scope-1')).toEqual([
      {
        name: 'total',
        value: { type: 'number', value: 12, description: '12' },
      },
    ]);

    await manager.disconnect();
    await manager.connect('target-1');
    await vi.waitFor(() => {
      expect(
        harness.commands.filter((command) => command.method === 'Debugger.setBreakpointByUrl'),
      ).toHaveLength(2);
    });
    expect(manager.snapshot().capabilities).toMatchObject({
      asyncStacks: false,
      pauseOnExceptions: true,
      blackboxing: true,
      logpoints: true,
    });

    harness.socket!.terminate();
    await vi.waitFor(() => expect(manager.snapshot().status).toBe('reconnecting'));
    await vi.waitFor(() => expect(manager.snapshot().status).toBe('connected'), {
      timeout: 3_000,
    });

    manager.close();
  });

  it('turns a Metro 401 into an actionable debugger conflict diagnostic', async () => {
    const harness = await createHarness(true);
    const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-debugger-401-'));
    const manager = new DebuggerManager(
      join(directory, 'debugger.json'),
      () => harness.port,
      vi.fn(),
    );
    await manager.discover();
    await expect(manager.connect('target-1')).rejects.toThrow('401');
    expect(manager.snapshot().error).toContain('HTTP 401');
    manager.close();
  });
});
