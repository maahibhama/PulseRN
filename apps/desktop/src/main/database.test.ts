import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { EventDatabase } from './database.js';

const directories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-database-'));
  directories.push(directory);
  return join(directory, 'events.sqlite');
}

function event(sequence: number, overrides: Partial<DevToolEventEnvelope> = {}) {
  return {
    id: `event-${sequence.toString().padStart(6, '0')}`,
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 'session-1',
    deviceId: 'device-1',
    appId: 'app-1',
    timestamp: 1_000 + sequence,
    sequence,
    category: 'console',
    type: 'console.log',
    payload: {
      level: 'log',
      arguments: [`event ${sequence}`],
      message: `event ${sequence}`,
    },
    ...overrides,
  } satisfies DevToolEventEnvelope;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('EventDatabase', () => {
  it('migrates an existing unversioned event database without losing events', () => {
    const path = databasePath();
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        sequence INTEGER NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        envelope_json TEXT NOT NULL
      );
    `);
    const existing = event(1);
    legacy
      .prepare(
        `
          INSERT INTO events (
            id, session_id, device_id, timestamp, sequence, category, type, envelope_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        existing.id,
        existing.sessionId,
        existing.deviceId,
        existing.timestamp,
        existing.sequence,
        existing.category,
        existing.type,
        JSON.stringify(existing),
      );
    legacy.close();

    const database = new EventDatabase(path);
    expect(database.schemaVersion()).toBe(2);
    expect(database.query().events).toEqual([existing]);
    expect(database.listSessions()).toMatchObject([
      {
        sessionId: 'session-1',
        eventCount: 1,
      },
    ]);
    database.close();
  });

  it('paginates deterministically in newest and oldest order', () => {
    const database = new EventDatabase(databasePath());
    database.recordSession({
      connectionId: 'connection-1',
      sessionId: 'session-1',
      deviceId: 'device-1',
      appId: 'app-1',
      connectedAt: 1_000,
      device: {
        name: 'iPhone',
        appName: 'Example',
        platform: 'ios',
        sdkVersion: '0.2.1',
      },
    });
    const events = Array.from({ length: 1_205 }, (_, sequence) => event(sequence));
    database.insertMany(events);

    const first = database.query({ limit: 500, order: 'newest' });
    const second = database.query({
      cursor: first.nextCursor,
      limit: 500,
      order: 'newest',
    });
    const third = database.query({
      cursor: second.nextCursor,
      limit: 500,
      order: 'newest',
    });
    const ids = [...first.events, ...second.events, ...third.events].map((entry) => entry.id);
    expect(ids).toHaveLength(1_205);
    expect(new Set(ids).size).toBe(1_205);
    expect(ids.at(0)).toBe('event-001204');
    expect(ids.at(-1)).toBe('event-000000');
    expect(third.hasMore).toBe(false);
    expect(first.total).toBe(1_205);

    const oldest = database.query({ limit: 2, order: 'oldest' });
    expect(oldest.events.map((entry) => entry.id)).toEqual(['event-000000', 'event-000001']);
    expect(database.listSessions()[0]?.eventCount).toBe(1_205);
    database.close();
  });

  it('filters event pages and does not double-count duplicate event IDs', () => {
    const database = new EventDatabase(databasePath());
    database.recordSession({
      connectionId: 'connection-1',
      sessionId: 'session-1',
      deviceId: 'device-1',
      appId: 'app-1',
      connectedAt: 1_000,
      device: {
        name: 'Pixel',
        appName: 'Example',
        platform: 'android',
        sdkVersion: '0.2.1',
      },
    });
    const consoleEvent = event(1);
    const errorEvent = event(2, {
      category: 'error',
      type: 'error.captured',
      payload: {
        source: 'manual',
        name: 'Error',
        message: 'Example',
        fatal: false,
        context: [],
      },
    });
    database.insertMany([consoleEvent, errorEvent, consoleEvent]);

    expect(database.query({ category: 'error' }).events).toEqual([errorEvent]);
    expect(database.findById(consoleEvent.id)).toEqual(consoleEvent);
    expect(database.listSessions()[0]?.eventCount).toBe(2);
    database.close();
  });
});
