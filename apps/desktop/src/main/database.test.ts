import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(database.schemaVersion()).toBe(6);
    expect(database.migrationHistory().map((migration) => migration.version)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(database.query().events).toEqual([existing]);
    expect(database.listSessions()).toMatchObject([
      {
        sessionId: 'session-1',
        eventCount: 1,
      },
    ]);
    database.close();
  });

  it.each([1, 2, 3, 4, 5])('upgrades supported schema version %s transactionally', (version) => {
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
    if (version >= 2) {
      legacy.exec(`
        CREATE TABLE sessions (
          session_id TEXT PRIMARY KEY,
          app_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          app_name TEXT NOT NULL,
          device_name TEXT NOT NULL,
          platform TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          event_count INTEGER NOT NULL DEFAULT 0
        );
      `);
    }
    if (version >= 3) {
      legacy.exec(`
        CREATE TABLE devices (
          device_id TEXT NOT NULL,
          app_id TEXT NOT NULL,
          name TEXT NOT NULL,
          app_name TEXT NOT NULL,
          platform TEXT NOT NULL,
          platform_version TEXT,
          model TEXT,
          app_version TEXT,
          sdk_version TEXT NOT NULL,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          session_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (device_id, app_id)
        );
      `);
    }
    if (version >= 4) {
      legacy.exec(`
        ALTER TABLE sessions ADD COLUMN app_version TEXT;
        ALTER TABLE sessions ADD COLUMN sdk_version TEXT;
        ALTER TABLE sessions ADD COLUMN protocol_version TEXT;
        ALTER TABLE sessions ADD COLUMN ended_at INTEGER;
        ALTER TABLE sessions ADD COLUMN connection_count INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE retention_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          max_age_days INTEGER NOT NULL,
          max_events INTEGER NOT NULL,
          last_run_at INTEGER NOT NULL
        );
      `);
    }
    if (version >= 5) {
      legacy.exec(`
        ALTER TABLE sessions ADD COLUMN display_name TEXT;
        ALTER TABLE sessions ADD COLUMN trust_status TEXT;
        ALTER TABLE sessions ADD COLUMN disconnect_code INTEGER;
        ALTER TABLE sessions ADD COLUMN disconnect_reason TEXT;
      `);
    }
    legacy.exec(`PRAGMA user_version = ${version};`);
    legacy.close();

    const database = new EventDatabase(path);
    expect(database.schemaVersion()).toBe(6);
    expect(database.migrationHistory().map((migration) => migration.version)).toEqual([
      1, 2, 3, 4, 5, 6,
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
    const newer = database.query({
      cursor: third.previousCursor,
      direction: 'backward',
      limit: 500,
      order: 'newest',
    });
    expect(newer.events.at(0)?.id).toBe('event-000704');
    expect(newer.hasPrevious).toBe(true);
    expect(newer.hasNext).toBe(true);
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

  it('filters a page by multiple inspector categories', () => {
    const database = new EventDatabase(databasePath());
    database.insertMany([
      event(1),
      event(2, {
        category: 'error',
        type: 'error.captured',
        payload: {
          source: 'manual',
          name: 'Error',
          message: 'Example',
          fatal: false,
          context: [],
        },
      }),
      event(3),
    ]);

    const page = database.query({ categories: ['console', 'error'], order: 'oldest' });

    expect(page.events.map((entry) => entry.category)).toEqual(['console', 'error', 'console']);
    expect(page.total).toBe(3);
    database.close();
  });

  it('filters by type, time, text, correlation, and errors', () => {
    const database = new EventDatabase(databasePath());
    const correlated = event(2, {
      correlationId: 'checkout-42',
      parentId: 'event-000001',
      type: 'console.warn',
      payload: {
        level: 'warn',
        arguments: ['Checkout delayed'],
        message: 'Checkout delayed',
      },
    });
    const errorEvent = event(3, {
      category: 'error',
      type: 'error.captured',
      payload: {
        source: 'manual',
        name: 'Error',
        message: 'Checkout failed',
        fatal: false,
        context: [],
      },
    });
    database.insertMany([event(1), correlated, errorEvent]);

    expect(database.query({ type: 'console.warn' }).events).toEqual([correlated]);
    expect(database.query({ startTime: 1_002, endTime: 1_002 }).events).toEqual([correlated]);
    expect(database.query({ text: 'checkout DELAYED' }).events).toEqual([correlated]);
    expect(database.query({ correlationId: 'checkout-42' }).events).toEqual([correlated]);
    expect(database.query({ parentId: 'event-000001' }).events).toEqual([correlated]);
    expect(database.query({ errorsOnly: true }).events).toEqual([errorEvent]);
    database.close();
  });

  it('persists saved filters, bookmarks, and annotations separately from events', () => {
    const database = new EventDatabase(databasePath());
    database.insertMany([event(1)]);

    const filter = database.saveFilter('Checkout errors', {
      errorsOnly: true,
      text: 'checkout',
    });
    const bookmark = database.addBookmark('event-000001', 'Investigate');
    const annotation = database.saveAnnotation('event-000001', 'Reproduced on iOS.');

    expect(database.listSavedFilters()).toEqual([filter]);
    expect(database.listBookmarks()).toEqual([bookmark]);
    expect(database.listAnnotations('event-000001')).toEqual([annotation]);
    expect(database.findById('event-000001')).toEqual(event(1));

    expect(database.deleteSavedFilter(filter.id)).toBe(true);
    expect(database.deleteBookmark(bookmark.id)).toBe(true);
    expect(database.deleteAnnotation(annotation.id)).toBe(true);
    database.close();
  });

  it('removes expired and overflow events while repairing session counts', () => {
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
    const now = 40 * 24 * 60 * 60 * 1_000;
    database.insertMany([
      event(0, { timestamp: 1 }),
      ...Array.from({ length: 1_005 }, (_, index) =>
        event(index + 1, { timestamp: now - 1_000 + index }),
      ),
    ]);

    const report = database.maintain({ maxAgeDays: 30, maxEvents: 1_000 }, now);

    expect(report).toMatchObject({
      integrity: 'ok',
      removedExpired: 1,
      removedOverflow: 5,
      retainedEvents: 1_000,
    });
    expect(database.listSessions()[0]?.eventCount).toBe(1_000);
    expect(database.query({ order: 'oldest', limit: 1 }).events[0]?.id).toBe('event-000006');
    expect(database.retentionState()).toEqual({
      maxAgeDays: 30,
      maxEvents: 1_000,
      lastRunAt: now,
    });
    database.close();
  });

  it('persists device and expanded session metadata', () => {
    const database = new EventDatabase(databasePath());
    database.recordSession({
      connectionId: 'connection-1',
      sessionId: 'session-1',
      deviceId: 'device-1',
      appId: 'app-1',
      protocolVersion: '1.0.0',
      connectedAt: 1_000,
      device: {
        name: 'iPhone',
        appName: 'Example',
        appVersion: '1.2.3',
        platform: 'ios',
        platformVersion: '18.0',
        model: 'Simulator',
        sdkVersion: '0.2.1',
      },
    });
    database.endSession('session-1', 2_000);

    expect(database.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: 'device-1',
        appVersion: '1.2.3',
        sdkVersion: '0.2.1',
        sessionCount: 1,
      }),
    ]);
    expect(database.listSessions()).toEqual([
      expect.objectContaining({
        protocolVersion: '1.0.0',
        endedAt: 2_000,
        connectionCount: 1,
      }),
    ]);
    database.close();
  });

  it('renames and permanently deletes a stored session transactionally', () => {
    const database = new EventDatabase(databasePath());
    database.recordSession({
      connectionId: 'connection-1',
      sessionId: 'session-1',
      deviceId: 'device-1',
      appId: 'app-1',
      connectedAt: 1_000,
      trustStatus: 'trusted',
      device: {
        name: 'iPhone',
        appName: 'Example',
        platform: 'ios',
        sdkVersion: '0.2.1',
      },
    });
    database.insertMany([event(1), event(2)]);

    expect(database.renameSession('session-1', 'Checkout regression')).toMatchObject({
      displayName: 'Checkout regression',
      trustStatus: 'trusted',
    });
    expect(database.deleteSession('session-1')).toEqual({ sessions: 1, events: 2 });
    expect(database.listSessions()).toEqual([]);
    expect(database.query().total).toBe(0);
    database.close();
  });

  it('backs up an unreadable database and reports recovery', () => {
    const path = databasePath();
    writeFileSync(path, 'not a sqlite database');

    const database = new EventDatabase(path);
    const recovery = database.recoveryReport();

    expect(recovery.status).toBe('recovered');
    expect(recovery.backupPath && existsSync(recovery.backupPath)).toBe(true);
    expect(recovery.lossesUnknown).toBe(true);
    expect(database.schemaVersion()).toBe(6);
    expect(database.query().total).toBe(0);
    database.close();
  });

  it('rejects future schemas without replacing their data', () => {
    const path = databasePath();
    const future = new DatabaseSync(path);
    future.exec('PRAGMA user_version = 99;');
    future.close();

    expect(() => new EventDatabase(path)).toThrow(/newer than supported/);
    const reopened = new DatabaseSync(path);
    expect(
      (
        reopened.prepare('PRAGMA user_version;').get() as unknown as {
          user_version: number;
        }
      ).user_version,
    ).toBe(99);
    reopened.close();
  });

  it('rolls back an interrupted write transaction', () => {
    const path = databasePath();
    const database = new EventDatabase(path);
    database.close();
    const interrupted = new DatabaseSync(path);
    interrupted.exec('BEGIN IMMEDIATE;');
    interrupted
      .prepare(
        `
          INSERT INTO events (
            id, session_id, device_id, timestamp, sequence, category, type, envelope_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run('interrupted', 'session-1', 'device-1', 1, 1, 'console', 'console.log', '{}');
    interrupted.close();

    const reopened = new EventDatabase(path);
    expect(reopened.findById('interrupted')).toBeUndefined();
    expect(reopened.schemaVersion()).toBe(6);
    reopened.close();
  });

  it('clears persisted events and session counts', () => {
    const database = new EventDatabase(databasePath());
    database.insertMany([event(1), event(2)]);

    expect(database.clear().retainedEvents).toBe(0);
    expect(database.query().total).toBe(0);
    database.close();
  });
});
