import { describe, expect, it } from 'vitest';
import {
  createAsyncStorageProvider,
  createDevToolMiddleware,
  createMMKVStorageProvider,
  createNavigationTracker,
  createPulseRNClient,
  diffStates,
  getActiveRoute,
  getOrCreatePulseRNDeviceId,
  ReactNativeDevTool,
} from '../src/index.js';

describe('single-entry SDK API', () => {
  it('exports every integration from the package root', () => {
    expect(createPulseRNClient).toBeTypeOf('function');
    expect(createAsyncStorageProvider).toBeTypeOf('function');
    expect(createMMKVStorageProvider).toBeTypeOf('function');
    expect(createDevToolMiddleware).toBeTypeOf('function');
    expect(diffStates).toBeTypeOf('function');
    expect(createNavigationTracker).toBeTypeOf('function');
    expect(getActiveRoute).toBeTypeOf('function');
    expect(getOrCreatePulseRNDeviceId).toBeTypeOf('function');
    expect(ReactNativeDevTool.configure).toBeTypeOf('function');
  });

  it('creates an unconnected client without native integration dependencies', () => {
    const client = createPulseRNClient({ appName: 'PublicApiTest' });
    expect(client.getStats()).toEqual({
      clockOffsetMs: 0,
      connected: false,
      droppedEvents: 0,
      oversizedEvents: 0,
      queueOverflowEvents: 0,
      consoleDroppedEvents: 0,
      queuedEvents: 0,
      reconnectAttempts: 0,
      sentBatches: 0,
      sentEvents: 0,
      socketBufferedBytes: 0,
    });
    client.disconnect();
  });
});
