import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { EventDatabase } from './database.js';
import { DiagnosticService } from './diagnostic-service.js';
import { SessionManager } from './session-manager.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function envelope(
  sequence: number,
  input: Pick<DevToolEventEnvelope, 'category' | 'type' | 'payload'> &
    Partial<DevToolEventEnvelope>,
): DevToolEventEnvelope {
  return {
    id: `event-${sequence}`,
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 'session-1',
    deviceId: 'device-1',
    appId: 'app-1',
    timestamp: 1_000 + sequence * 100,
    sequence,
    ...input,
  };
}

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-diagnostics-'));
  directories.push(directory);
  const database = new EventDatabase(join(directory, 'events.sqlite'));
  database.recordSession({
    connectionId: 'connection-1',
    sessionId: 'session-1',
    deviceId: 'device-1',
    appId: 'app-1',
    connectedAt: 1_000,
    device: {
      name: 'Pixel',
      appName: 'Checkout',
      platform: 'android',
      sdkVersion: '0.1.0',
    },
  });
  return { database, service: new DiagnosticService(database, new SessionManager()) };
}

describe('DiagnosticService', () => {
  it('builds deterministic findings and ranks explicit evidence above proximity', () => {
    const { database, service } = setup();
    const navigation = envelope(1, {
      category: 'navigation',
      type: 'navigation.focus',
      correlationId: 'checkout',
      payload: {
        navigatorId: 'root',
        source: 'react-navigation',
        lifecycle: 'focus',
        action: 'navigate',
        currentRoute: { name: 'Checkout' },
      },
    });
    const redux = envelope(2, {
      category: 'redux',
      type: 'redux.action',
      correlationId: 'checkout',
      payload: {
        storeId: 'main',
        actionType: 'checkout/submit',
        action: { type: 'checkout/submit' },
        reducerDuration: 2,
      },
    });
    const network = envelope(3, {
      category: 'network',
      type: 'network.request',
      correlationId: 'checkout',
      payload: {
        requestId: 'request-1',
        transport: 'fetch',
        method: 'POST',
        url: 'https://example.test/checkout',
        query: {},
        requestHeaders: {},
        status: 500,
        startedAt: 1_200,
        endedAt: 1_300,
        duration: 100,
      },
    });
    const error = envelope(4, {
      category: 'error',
      type: 'error.manual',
      correlationId: 'checkout',
      payload: {
        source: 'manual',
        name: 'CheckoutError',
        message: 'Payment failed',
        fatal: false,
        context: [
          {
            id: redux.id,
            timestamp: redux.timestamp,
            sequence: redux.sequence,
            category: redux.category,
            type: redux.type,
          },
        ],
        correlations: {
          requestId: network.id,
        },
      },
    });
    database.insertMany([navigation, redux, network, error]);

    const first = service.diagnose('session-1');
    const second = service.diagnose('session-1');
    const errorFinding = first.findings.find((finding) => finding.kind === 'application_error');

    expect(first.findings.map(({ id }) => id)).toEqual(second.findings.map(({ id }) => id));
    expect(errorFinding?.relations[0]).toMatchObject({
      eventId: network.id,
      confidence: 1,
      reason: 'explicit_event_id',
    });
    expect(errorFinding?.relations.find((relation) => relation.eventId === redux.id)).toMatchObject(
      {
        reason: 'matching_correlation_id',
        confidence: 0.96,
      },
    );
    expect(first.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining([
        'application_error',
        'network_failure',
        'redux_preceding_failure',
        'navigation_preceding_failure',
      ]),
    );
    database.close();
  });

  it('persists at most twenty snapshots for a session', () => {
    const { database, service } = setup();
    database.insertMany([
      envelope(1, {
        category: 'error',
        type: 'error.manual',
        payload: {
          source: 'manual',
          name: 'Error',
          message: 'Failure',
          fatal: false,
          context: [],
        },
      }),
    ]);
    const diagnosis = service.diagnose('session-1');
    for (let index = 0; index < 21; index += 1) {
      database.saveDiagnosticSnapshot({
        version: 1,
        id: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
        sessionId: 'session-1',
        createdAt: index,
        diagnosis,
        events: [],
      });
    }

    expect(database.listDiagnosticSnapshots('session-1')).toHaveLength(20);
    expect(database.listDiagnosticSnapshots('session-1').at(-1)?.createdAt).toBe(1);
    database.deleteSession('session-1');
    expect(database.listDiagnosticSnapshots('session-1')).toEqual([]);
    database.close();
  });
});
