import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  consoleLogPayloadSchema,
  eventEnvelopeSchema,
  networkEventPayloadSchema,
  negotiateProtocolVersion,
  parseClientMessage,
} from '../src/index.js';

describe('protocol', () => {
  it('negotiates the current version', () => {
    expect(negotiateProtocolVersion(['0.9.0', PROTOCOL_VERSION])).toBe(PROTOCOL_VERSION);
    expect(negotiateProtocolVersion(['0.9.0'])).toBeUndefined();
  });

  it('rejects malformed event envelopes without throwing', () => {
    expect(eventEnvelopeSchema.safeParse({ type: 'test' }).success).toBe(false);
    expect(parseClientMessage({ kind: 'event-batch', events: [] }).success).toBe(false);
  });

  it('validates console payloads', () => {
    expect(
      consoleLogPayloadSchema.safeParse({
        level: 'warn',
        arguments: ['slow render', { duration: 120 }],
        message: 'slow render {"duration":120}',
      }).success,
    ).toBe(true);
    expect(
      consoleLogPayloadSchema.safeParse({
        level: 'verbose',
        arguments: [],
        message: '',
      }).success,
    ).toBe(false);
  });

  it('validates completed network requests', () => {
    expect(
      networkEventPayloadSchema.safeParse({
        requestId: 'request-1',
        transport: 'fetch',
        method: 'GET',
        url: 'https://example.com/users',
        query: {},
        requestHeaders: {},
        status: 200,
        responseHeaders: { 'content-type': 'application/json' },
        startedAt: 100,
        endedAt: 140,
        duration: 40,
      }).success,
    ).toBe(true);
  });
});
