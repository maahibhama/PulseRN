import { PROTOCOL_VERSION, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { describe, expect, it } from 'vitest';
import { latestMatchingEventId } from './useInspectorEvents.js';

function event(
  id: string,
  category: DevToolEventEnvelope['category'],
  sequence: number,
): DevToolEventEnvelope {
  return {
    id,
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 'session-1',
    deviceId: 'device-1',
    appId: 'app-1',
    timestamp: sequence,
    sequence,
    category,
    type: `${category}.test`,
    payload: {},
  };
}

describe('latestMatchingEventId', () => {
  it('keeps an inspector live when another category follows its event in the batch', () => {
    const events = [
      event('navigation-1', 'navigation', 1),
      event('performance-1', 'performance', 2),
      event('console-1', 'console', 3),
    ];

    expect(latestMatchingEventId(events, ['navigation'])).toBe('navigation-1');
    expect(latestMatchingEventId(events, ['performance', 'network'])).toBe('performance-1');
  });

  it('returns undefined when the active view has no matching event', () => {
    expect(latestMatchingEventId([event('console-1', 'console', 1)], ['redux'])).toBeUndefined();
    expect(latestMatchingEventId([], undefined)).toBeUndefined();
  });
});
