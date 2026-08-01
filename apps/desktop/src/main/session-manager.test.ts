import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { SessionManager } from './session-manager.js';

describe('SessionManager', () => {
  it('tracks connections and bounds the renderer projection', () => {
    const manager = new SessionManager();
    manager.connect({
      connectionId: 'connection-1',
      deviceId: 'device-1',
      sessionId: 'session-1',
      appId: 'app-1',
      connectedAt: 1,
      device: {
        name: 'Simulator',
        platform: 'ios',
        appName: 'Example',
        sdkVersion: '0.1.0',
      },
    });
    const event: DevToolEventEnvelope = {
      id: 'event-1',
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 'session-1',
      deviceId: 'device-1',
      appId: 'app-1',
      timestamp: 1,
      sequence: 0,
      category: 'system',
      type: 'test',
      payload: {},
    };
    manager.append([event]);
    expect(manager.snapshot()).toMatchObject({
      devices: [{ connectionId: 'connection-1' }],
      events: [{ id: 'event-1' }],
    });
    manager.updateHealth(
      'connection-1',
      {
        kind: 'client-health',
        sentAt: 10,
        queuedEvents: 2,
        droppedEvents: 1,
        oversizedEvents: 1,
        queueOverflowEvents: 0,
        sentEvents: 20,
        sentBatches: 2,
        reconnectAttempts: 0,
        socketBufferedBytes: 128,
        clockOffsetMs: -3,
      },
      12,
    );
    expect(manager.snapshot().devices[0]?.health).toMatchObject({
      queuedEvents: 2,
      droppedEvents: 1,
      receivedAt: 12,
    });
    manager.disconnect('connection-1');
    expect(manager.snapshot().devices).toEqual([]);
  });
});
