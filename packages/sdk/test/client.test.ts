import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@pulse-rn/protocol';
import { DevToolClient } from '../src/client.js';
import type { WebSocketLike } from '../src/types.js';

function createSocket(): WebSocketLike & { sent: string[] } {
  return {
    readyState: 1,
    sent: [],
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data) {
      this.sent.push(data);
    },
    close() {},
  };
}

describe('DevToolClient', () => {
  it('handshakes, redacts, and batches events', () => {
    vi.useFakeTimers();
    const socket = createSocket();
    const client = new DevToolClient(
      { appName: 'Example', batchIntervalMs: 10, isDevelopment: true },
      () => socket,
    ).connect();
    socket.onopen?.();
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({ kind: 'client-hello' });
    socket.onmessage?.({
      data: JSON.stringify({
        kind: 'server-hello',
        accepted: true,
        protocolVersion: PROTOCOL_VERSION,
        connectionId: 'connection-1',
        serverTime: Date.now(),
      }),
    });
    client.track({ category: 'system', type: 'sdk.test', payload: { token: 'secret' } });
    vi.advanceTimersByTime(11);
    expect(JSON.parse(socket.sent[1] ?? '{}').events[0].payload.token).toBe('[REDACTED]');
    client.disconnect();
    vi.useRealTimers();
  });

  it('caps the offline queue and records dropped events', () => {
    const socket = createSocket();
    const client = new DevToolClient(
      { appName: 'Example', maxQueueSize: 2, isDevelopment: true },
      () => socket,
    );
    for (let index = 0; index < 3; index += 1) {
      client.track({ category: 'system', type: 'test', payload: { index } });
    }
    expect(client.getStats()).toMatchObject({ queuedEvents: 2, droppedEvents: 1 });
    client.disconnect();
  });
});
