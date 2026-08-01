import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  clientHealthSchema,
  clientHelloSchema,
  consoleLogPayloadSchema,
  errorEventPayloadSchema,
  eventEnvelopeSchema,
  networkEventPayloadSchema,
  navigationEventPayloadSchema,
  negotiateProtocolVersion,
  parseClientMessage,
  performanceEventPayloadSchema,
  reduxEventPayloadSchema,
  networkLifecycleEventPayloadSchema,
  storageCommandSchema,
  storageEventPayloadSchema,
  storageResultSchema,
  serverHelloSchema,
} from '../src/index.js';

describe('protocol', () => {
  it('negotiates the current version', () => {
    expect(negotiateProtocolVersion(['0.9.0', PROTOCOL_VERSION])).toBe(PROTOCOL_VERSION);
    expect(negotiateProtocolVersion(['0.9.0'])).toBeUndefined();
  });

  it('validates additive pairing and reconnect credentials', () => {
    expect(
      clientHelloSchema.safeParse({
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
        pairingCode: 'ABCD-EFGH',
      }).success,
    ).toBe(true);
    expect(
      serverHelloSchema.safeParse({
        kind: 'server-hello',
        accepted: true,
        protocolVersion: PROTOCOL_VERSION,
        connectionId: 'connection-1',
        serverTime: 1,
        trustStatus: 'paired',
        reconnectToken: 'r'.repeat(43),
      }).success,
    ).toBe(true);
  });

  it('rejects malformed event envelopes without throwing', () => {
    expect(eventEnvelopeSchema.safeParse({ type: 'test' }).success).toBe(false);
    expect(parseClientMessage({ kind: 'event-batch', events: [] }).success).toBe(false);
  });

  it('validates bounded client health diagnostics', () => {
    expect(
      clientHealthSchema.safeParse({
        kind: 'client-health',
        sentAt: 100,
        queuedEvents: 4,
        droppedEvents: 2,
        oversizedEvents: 1,
        queueOverflowEvents: 1,
        consoleDroppedEvents: 3,
        sentEvents: 20,
        sentBatches: 2,
        reconnectAttempts: 1,
        socketBufferedBytes: 512,
        clockOffsetMs: -4,
        lastEventAt: 99,
      }).success,
    ).toBe(true);
    expect(
      clientHealthSchema.safeParse({
        kind: 'client-health',
        sentAt: 100,
        queuedEvents: -1,
      }).success,
    ).toBe(false);
  });

  it('validates console payloads', () => {
    expect(
      consoleLogPayloadSchema.safeParse({
        level: 'warn',
        arguments: ['slow render', { duration: 120 }],
        message: 'slow render {"duration":120}',
        redacted: true,
        truncated: true,
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

  it('validates additive network lifecycle events without changing completed requests', () => {
    expect(
      networkLifecycleEventPayloadSchema.safeParse({
        phase: 'progress',
        requestId: 'request-1',
        transport: 'xhr',
        method: 'GET',
        url: 'https://example.com/download',
        timestamp: 120,
        startedAt: 100,
        loadedBytes: 512,
        totalBytes: 1_024,
        timingAccuracy: 'approximate',
      }).success,
    ).toBe(true);
    expect(
      networkLifecycleEventPayloadSchema.safeParse({
        phase: 'progress',
        requestId: 'request-1',
        transport: 'xhr',
        method: 'GET',
        url: 'https://example.com/download',
        timestamp: 120,
        startedAt: 100,
        loadedBytes: -1,
        timingAccuracy: 'approximate',
      }).success,
    ).toBe(false);
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
        changedPaths: ['$.count'],
        actionCategory: 'domain',
        stateSize: {
          previousBytes: 11,
          nextBytes: 11,
          warningThresholdBytes: 262_144,
          truncated: false,
        },
        correlations: {
          route: 'Checkout',
          requestId: 'request-1',
        },
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
        routePath: ['RootStack', 'Details'],
        routeTree: [
          {
            navigatorId: 'root',
            route: { key: 'details-1', name: 'Details' },
            active: true,
            depth: 0,
          },
        ],
        parameterDiff: [{ path: '$.itemId', kind: 'added', after: 42 }],
        actionGroup: 'forward',
        warnings: ['incomplete_tracking'],
        integrationMetadata: { pathname: '/details' },
        correlations: { requestId: 'request-1' },
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
        provenance: 'javascript',
        sampling: {
          intervalMs: 1_000,
          expectedSamples: 10,
          lostSamples: 1,
          captureRate: 10 / 11,
        },
      }).success,
    ).toBe(true);
    expect(
      performanceEventPayloadSchema.safeParse({
        metric: 'capability',
        name: 'native cpu',
        value: 0,
        unit: 'count',
        approximate: false,
        provenance: 'runtime',
        capability: {
          name: 'native_cpu',
          status: 'unavailable',
          reason: 'Native CPU profiling is outside SDK capability.',
        },
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
