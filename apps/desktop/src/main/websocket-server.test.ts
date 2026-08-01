import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '@pulse-rn/protocol';
import { accessTokensMatch, DevToolWebSocketServer } from './websocket-server.js';

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

async function handshake(port: number, authToken?: string): Promise<Record<string, unknown>> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
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
});
