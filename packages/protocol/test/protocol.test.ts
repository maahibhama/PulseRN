import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  consoleLogPayloadSchema,
  errorEventPayloadSchema,
  eventEnvelopeSchema,
  networkEventPayloadSchema,
  navigationEventPayloadSchema,
  negotiateProtocolVersion,
  parseClientMessage,
  performanceEventPayloadSchema,
  reduxEventPayloadSchema,
  storageCommandSchema,
  storageEventPayloadSchema,
  storageResultSchema,
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

  it('validates Redux actions and state diffs', () => {
    expect(
      reduxEventPayloadSchema.safeParse({
        storeId: 'main',
        actionType: 'counter/increment',
        action: { type: 'counter/increment' },
        previousState: { count: 0 },
        nextState: { count: 1 },
        stateDiff: [{ path: '$.count', kind: 'changed', before: 0, after: 1 }],
        reducerDuration: 0.25,
      }).success,
    ).toBe(true);
  });

  it('validates navigation lifecycle events', () => {
    expect(
      navigationEventPayloadSchema.safeParse({
        navigatorId: 'root',
        source: 'react-navigation',
        lifecycle: 'state',
        action: 'push',
        previousRoute: { key: 'home-1', name: 'Home' },
        currentRoute: {
          key: 'details-1',
          name: 'Details',
          params: { itemId: 42, token: '[REDACTED]' },
        },
        previousRouteDuration: 1_250,
      }).success,
    ).toBe(true);
  });

  it('validates performance metrics and approximation labels', () => {
    expect(
      performanceEventPayloadSchema.safeParse({
        metric: 'js_stall',
        name: 'JavaScript thread stall',
        value: 138,
        unit: 'ms',
        approximate: true,
      }).success,
    ).toBe(true);
  });

  it('validates storage commands, results, and audit events', () => {
    expect(
      storageCommandSchema.safeParse({
        kind: 'storage-command',
        requestId: 'storage-1',
        providerId: 'async-storage',
        operation: 'get',
        key: 'session',
      }).success,
    ).toBe(true);
    expect(
      storageResultSchema.safeParse({
        kind: 'storage-result',
        requestId: 'storage-1',
        providerId: 'async-storage',
        operation: 'get',
        success: true,
        value: '{"user":"developer"}',
      }).success,
    ).toBe(true);
    expect(
      storageEventPayloadSchema.safeParse({
        requestId: 'storage-1',
        providerId: 'async-storage',
        operation: 'get',
        key: 'session',
        success: true,
        mutation: false,
        duration: 1.2,
      }).success,
    ).toBe(true);
  });

  it('validates errors with bounded timeline context', () => {
    expect(
      errorEventPayloadSchema.safeParse({
        source: 'react_boundary',
        name: 'TypeError',
        message: 'Cannot read property',
        stack: 'TypeError: Cannot read property\n    at Checkout',
        componentStack: '\n    at CheckoutScreen',
        screen: 'Checkout',
        fatal: false,
        context: [
          {
            id: 'event-1',
            timestamp: 100,
            sequence: 1,
            category: 'redux',
            type: 'redux.action',
            summary: 'checkout/start',
          },
        ],
      }).success,
    ).toBe(true);
  });
});
