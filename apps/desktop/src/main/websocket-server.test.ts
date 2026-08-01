import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '@pulse-rn/protocol';
import {
  accessTokensMatch,
  DevToolWebSocketServer,
  validateWebSocketRequest,
} from './websocket-server.js';
import type { IncomingMessage } from 'node:http';

const servers: DevToolWebSocketServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function hello(authToken?: string) {
  return {
    kind: 'client-hello',
    supportedProtocolVersions: [PROTOCOL_VERSION],
    sessionId: 'session-1',
    deviceId: 'device-1',
    appId: 'app-1',
    device: {
      name: 'iPhone',
      platform: 'ios',
      appName: 'Example',
      sdkVersion: '0.2.1',
    },
    ...(authToken ? { authToken } : {}),
  };
}

async function handshake(
  port: number,
  authToken?: string,
  secure = false,
): Promise<Record<string, unknown>> {
  const socket = new WebSocket(`${secure ? 'wss' : 'ws'}://127.0.0.1:${port}`, {
    rejectUnauthorized: false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  socket.send(JSON.stringify(hello(authToken)));
  const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.once('message', (data) =>
      resolve(JSON.parse(data.toString()) as Record<string, unknown>),
    );
    socket.once('error', reject);
  });
  socket.close();
  return response;
}

describe('WebSocket access token authentication', () => {
  it('accepts only an exact token match', () => {
    const token = 'a'.repeat(43);
    expect(accessTokensMatch(token, token)).toBe(true);
    expect(accessTokensMatch(token, 'b'.repeat(43))).toBe(false);
    expect(accessTokensMatch(token, 'short')).toBe(false);
    expect(accessTokensMatch(token)).toBe(false);
  });

  it('rejects unauthenticated handshakes and accepts the configured LAN token', async () => {
    const onConnected = vi.fn();
    const server = new DevToolWebSocketServer(
      0,
      {
        onConnected,
        onDisconnected: vi.fn(),
        onEvents: vi.fn(),
        onHealth: vi.fn(),
        onInvalidMessage: vi.fn(),
      },
      '127.0.0.1',
      'a'.repeat(43),
    );
    servers.push(server);
    await server.start();
    const { port } = server.address();

    await expect(handshake(port)).resolves.toMatchObject({
      kind: 'server-hello',
      accepted: false,
      reason: 'Authentication failed',
    });
    await expect(handshake(port, 'a'.repeat(43))).resolves.toMatchObject({
      kind: 'server-hello',
      accepted: true,
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(onConnected).toHaveBeenCalledOnce();
  });

  it('authenticates device handshakes over TLS', async () => {
    const fixtureDirectory = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
    const server = new DevToolWebSocketServer(
      0,
      {
        onConnected: vi.fn(),
        onDisconnected: vi.fn(),
        onEvents: vi.fn(),
        onHealth: vi.fn(),
        onInvalidMessage: vi.fn(),
      },
      '127.0.0.1',
      'a'.repeat(43),
      {
        cert: readFileSync(join(fixtureDirectory, 'test-certificate.pem')),
        key: readFileSync(join(fixtureDirectory, 'test-private-key.pem')),
      },
    );
    servers.push(server);
    await server.start();

    await expect(handshake(server.address().port, 'a'.repeat(43), true)).resolves.toMatchObject({
      kind: 'server-hello',
      accepted: true,
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  it('returns a reconnect token after one-time pairing', async () => {
    const onConnected = vi.fn();
    const server = new DevToolWebSocketServer(
      0,
      {
        onConnected,
        onDisconnected: vi.fn(),
        onEvents: vi.fn(),
        onHealth: vi.fn(),
        onInvalidMessage: vi.fn(),
      },
      '127.0.0.1',
      (message) =>
        message.authToken === 'PAIR-CODE'
          ? {
              accepted: true,
              trustStatus: 'paired',
              reconnectToken: 'r'.repeat(43),
            }
          : { accepted: false, reason: 'Pairing required' },
    );
    servers.push(server);
    await server.start();

    await expect(handshake(server.address().port, 'PAIR-CODE')).resolves.toMatchObject({
      accepted: true,
      trustStatus: 'paired',
      reconnectToken: 'r'.repeat(43),
    });
    expect(onConnected).toHaveBeenCalledWith(
      expect.objectContaining({ trustStatus: 'paired', protocolVersion: PROTOCOL_VERSION }),
    );
  });

  it('rejects cross-origin browser handshakes', () => {
    expect(
      validateWebSocketRequest(
        {
          headers: {
            host: '192.168.1.10:9090',
            origin: 'https://attacker.example',
          },
        } as IncomingMessage,
        9090,
      ),
    ).toBe('Origin host does not match request host');
    expect(
      validateWebSocketRequest(
        {
          headers: {
            host: '192.168.1.10:9090',
            origin: 'http://192.168.1.10:8081',
          },
        } as IncomingMessage,
        9090,
      ),
    ).toBeUndefined();
  });
});
