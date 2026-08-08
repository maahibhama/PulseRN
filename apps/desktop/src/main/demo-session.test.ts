import { eventEnvelopeSchema } from '@pulse-rn/protocol';
import { describe, expect, it } from 'vitest';
import { createDemoSession } from './demo-session.js';

describe('createDemoSession', () => {
  it('creates an isolated validated event tour', () => {
    const demo = createDemoSession(1_800_000_000_000);
    expect(demo.device.sessionId).toMatch(/^pulsern-demo-/);
    expect(new Set(demo.events.map((event) => event.category))).toEqual(
      new Set([
        'console',
        'native-log',
        'network',
        'redux',
        'navigation',
        'performance',
        'storage',
        'error',
      ]),
    );
    for (const event of demo.events)
      expect(eventEnvelopeSchema.safeParse(event).success).toBe(true);
  });
});
