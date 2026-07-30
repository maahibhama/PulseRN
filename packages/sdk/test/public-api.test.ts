import { describe, expect, it } from 'vitest';
import {
  createAsyncStorageProvider,
  createDevToolMiddleware,
  createMMKVStorageProvider,
  createNavigationTracker,
  createPulseRNClient,
  diffStates,
  getActiveRoute,
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
    expect(ReactNativeDevTool.configure).toBeTypeOf('function');
  });

  it('creates an unconnected client without native integration dependencies', () => {
    const client = createPulseRNClient({ appName: 'PublicApiTest' });
    expect(client.getStats()).toEqual({
      connected: false,
      droppedEvents: 0,
      queuedEvents: 0,
    });
    client.disconnect();
  });
});
