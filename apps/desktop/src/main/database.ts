import { DatabaseSync } from 'node:sqlite';
import { eventEnvelopeSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import type { ConnectedDevice } from './session-manager.js';

const CURRENT_SCHEMA_VERSION = 2;

export interface EventCursor {
  timestamp: number;
  sequence: number;
  id: string;
}

export interface EventQuery {
  category?: DevToolEventEnvelope['category'];
  categories?: DevToolEventEnvelope['category'][];
  cursor?: EventCursor;
  deviceId?: string;
  limit?: number;
  order?: 'newest' | 'oldest';
  sessionId?: string;
}

export interface RetentionPolicy {
  maxAgeDays: number;
  maxEvents: number;
}

export interface DatabaseMaintenanceReport {
  integrity: 'ok' | 'recovered';
  removedExpired: number;
  removedOverflow: number;
  removedInvalid: number;
  retainedEvents: number;
  completedAt: number;
}

export interface EventPage {
  events: DevToolEventEnvelope[];
  hasMore: boolean;
  nextCursor?: EventCursor;
  total: number;
}

export interface StoredSession {
  sessionId: string;
  appId: string;
  deviceId: string;
  appName: string;
  deviceName: string;
  platform: string;
  startedAt: number;
  lastSeenAt: number;
  eventCount: number;
}

export class EventDatabase {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec('PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  private migrate(): void {
    const version = (
      this.database.prepare('PRAGMA user_version;').get() as unknown as { user_version: number }
    ).user_version;
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `PulseRN database schema ${version} is newer than supported schema ${CURRENT_SCHEMA_VERSION}.`,
      );
    }
    this.database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        sequence INTEGER NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        envelope_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_session_time
        ON events(session_id, timestamp, sequence);
      CREATE INDEX IF NOT EXISTS idx_events_device_time
        ON events(device_id, timestamp, sequence);
      CREATE INDEX IF NOT EXISTS idx_events_category_time
        ON events(category, timestamp, sequence);
      CREATE TABLE IF NOT EXISTS sessions (
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
      CREATE INDEX IF NOT EXISTS idx_sessions_last_seen
        ON sessions(last_seen_at DESC);
      INSERT OR IGNORE INTO sessions (
        session_id, app_id, device_id, app_name, device_name, platform,
        started_at, last_seen_at, event_count
      )
      SELECT
        session_id,
        COALESCE(MAX(json_extract(envelope_json, '$.appId')), 'unknown-app'),
        device_id,
        'Unknown app',
        'Unknown device',
        'unknown',
        MIN(timestamp),
        MAX(timestamp),
        COUNT(*)
      FROM events
      WHERE json_valid(envelope_json)
      GROUP BY session_id;
      PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};
      COMMIT;
    `);
  }

  recordSession(device: ConnectedDevice): void {
    this.database
      .prepare(
        `
          INSERT INTO sessions (
            session_id, app_id, device_id, app_name, device_name, platform,
            started_at, last_seen_at, event_count
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(session_id) DO UPDATE SET
            app_id = excluded.app_id,
            device_id = excluded.device_id,
            app_name = excluded.app_name,
            device_name = excluded.device_name,
            platform = excluded.platform,
            last_seen_at = MAX(sessions.last_seen_at, excluded.last_seen_at)
        `,
      )
      .run(
        device.sessionId,
        device.appId,
        device.deviceId,
        device.device.appName,
        device.device.name,
        device.device.platform,
        device.connectedAt,
        device.connectedAt,
      );
  }

  insertMany(events: readonly DevToolEventEnvelope[]): void {
    if (events.length === 0) return;
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const insert = this.database.prepare(`
        INSERT OR IGNORE INTO events
          (id, session_id, device_id, timestamp, sequence, category, type, envelope_json)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const sessions = new Map<string, { eventCount: number; lastSeenAt: number }>();
      for (const event of events) {
        const result = insert.run(
          event.id,
          event.sessionId,
          event.deviceId,
          event.timestamp,
          event.sequence,
          event.category,
          event.type,
          JSON.stringify(event),
        );
        if (result.changes === 0) continue;
        const current = sessions.get(event.sessionId);
        sessions.set(event.sessionId, {
          eventCount: (current?.eventCount ?? 0) + 1,
          lastSeenAt: Math.max(current?.lastSeenAt ?? event.timestamp, event.timestamp),
        });
      }
      const updateSession = this.database.prepare(`
        UPDATE sessions
        SET last_seen_at = MAX(last_seen_at, ?),
            event_count = event_count + ?
        WHERE session_id = ?
      `);
      for (const [sessionId, summary] of sessions) {
        updateSession.run(summary.lastSeenAt, summary.eventCount, sessionId);
      }
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  recent(limit = 500): DevToolEventEnvelope[] {
    const safeLimit = Math.max(1, Math.min(limit, 5_000));
    const rows = this.database
      .prepare('SELECT envelope_json FROM events ORDER BY timestamp DESC, sequence DESC LIMIT ?')
      .all(safeLimit) as unknown as { envelope_json: string }[];
    return rows.reverse().flatMap((row) => {
      try {
        const result = eventEnvelopeSchema.safeParse(JSON.parse(row.envelope_json) as unknown);
        return result.success ? [result.data] : [];
      } catch {
        return [];
      }
    });
  }

  query(input: EventQuery = {}): EventPage {
    const limit = Math.max(1, Math.min(input.limit ?? 200, 500));
    const order = input.order ?? 'newest';
    const filters: string[] = [];
    const filterValues: (number | string)[] = [];
    if (input.sessionId) {
      filters.push('session_id = ?');
      filterValues.push(input.sessionId);
    }
    if (input.deviceId) {
      filters.push('device_id = ?');
      filterValues.push(input.deviceId);
    }
    if (input.category) {
      filters.push('category = ?');
      filterValues.push(input.category);
    }
    if (input.categories?.length) {
      const categories = [...new Set(input.categories)];
      filters.push(`category IN (${categories.map(() => '?').join(', ')})`);
      filterValues.push(...categories);
    }
    const baseWhere = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const cursorOperator = order === 'newest' ? '<' : '>';
    const cursorFilter = input.cursor
      ? `(
          timestamp ${cursorOperator} ?
          OR (timestamp = ? AND sequence ${cursorOperator} ?)
          OR (timestamp = ? AND sequence = ? AND id ${cursorOperator} ?)
        )`
      : '';
    const pageWhere =
      cursorFilter.length === 0
        ? baseWhere
        : `${baseWhere.length === 0 ? 'WHERE' : `${baseWhere} AND`} ${cursorFilter}`;
    const pageValues = [...filterValues];
    if (input.cursor) {
      pageValues.push(
        input.cursor.timestamp,
        input.cursor.timestamp,
        input.cursor.sequence,
        input.cursor.timestamp,
        input.cursor.sequence,
        input.cursor.id,
      );
    }
    pageValues.push(limit + 1);
    const rows = this.database
      .prepare(
        `
          SELECT id, timestamp, sequence, envelope_json
          FROM events
          ${pageWhere}
          ORDER BY timestamp ${order === 'newest' ? 'DESC' : 'ASC'},
                   sequence ${order === 'newest' ? 'DESC' : 'ASC'},
                   id ${order === 'newest' ? 'DESC' : 'ASC'}
          LIMIT ?
        `,
      )
      .all(...pageValues) as unknown as {
      id: string;
      timestamp: number;
      sequence: number;
      envelope_json: string;
    }[];
    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;
    const events = visibleRows.flatMap((row) => {
      try {
        const result = eventEnvelopeSchema.safeParse(JSON.parse(row.envelope_json) as unknown);
        return result.success ? [result.data] : [];
      } catch {
        return [];
      }
    });
    const last = visibleRows.at(-1);
    const totalRow = this.database
      .prepare(`SELECT COUNT(*) AS count FROM events ${baseWhere}`)
      .get(...filterValues) as unknown as { count: number };
    return {
      events,
      hasMore,
      total: totalRow.count,
      ...(hasMore && last
        ? {
            nextCursor: {
              id: last.id,
              sequence: last.sequence,
              timestamp: last.timestamp,
            },
          }
        : {}),
    };
  }

  findById(id: string): DevToolEventEnvelope | undefined {
    const row = this.database
      .prepare('SELECT envelope_json FROM events WHERE id = ?')
      .get(id) as unknown as { envelope_json: string } | undefined;
    if (!row) return undefined;
    try {
      const result = eventEnvelopeSchema.safeParse(JSON.parse(row.envelope_json) as unknown);
      return result.success ? result.data : undefined;
    } catch {
      return undefined;
    }
  }

  maintain(policy: RetentionPolicy, now = Date.now()): DatabaseMaintenanceReport {
    const maxAgeDays = Math.max(1, Math.min(Math.trunc(policy.maxAgeDays), 365));
    const maxEvents = Math.max(1_000, Math.min(Math.trunc(policy.maxEvents), 1_000_000));
    const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1_000;
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const invalid = this.database
        .prepare('DELETE FROM events WHERE NOT json_valid(envelope_json)')
        .run().changes;
      const expired = this.database
        .prepare('DELETE FROM events WHERE timestamp < ?')
        .run(cutoff).changes;
      const overflow = this.database
        .prepare(
          `
            DELETE FROM events
            WHERE id IN (
              SELECT id FROM events
              ORDER BY timestamp DESC, sequence DESC, id DESC
              LIMIT -1 OFFSET ?
            )
          `,
        )
        .run(maxEvents).changes;
      this.refreshSessionCounts();
      const retained = (
        this.database.prepare('SELECT COUNT(*) AS count FROM events').get() as unknown as {
          count: number;
        }
      ).count;
      this.database.exec('COMMIT;');
      return {
        integrity: invalid > 0 ? 'recovered' : 'ok',
        removedExpired: Number(expired),
        removedOverflow: Number(overflow),
        removedInvalid: Number(invalid),
        retainedEvents: retained,
        completedAt: now,
      };
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  clear(): DatabaseMaintenanceReport {
    const completedAt = Date.now();
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const removed = this.database.prepare('DELETE FROM events').run().changes;
      this.refreshSessionCounts();
      this.database.exec('COMMIT;');
      return {
        integrity: 'ok',
        removedExpired: 0,
        removedOverflow: Number(removed),
        removedInvalid: 0,
        retainedEvents: 0,
        completedAt,
      };
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  private refreshSessionCounts(): void {
    this.database.exec(`
      UPDATE sessions
      SET event_count = (
        SELECT COUNT(*) FROM events WHERE events.session_id = sessions.session_id
      );
    `);
  }

  listSessions(limit = 100): StoredSession[] {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    return this.database
      .prepare(
        `
          SELECT
            session_id AS sessionId,
            app_id AS appId,
            device_id AS deviceId,
            app_name AS appName,
            device_name AS deviceName,
            platform,
            started_at AS startedAt,
            last_seen_at AS lastSeenAt,
            event_count AS eventCount
          FROM sessions
          ORDER BY last_seen_at DESC
          LIMIT ?
        `,
      )
      .all(safeLimit) as unknown as StoredSession[];
  }

  schemaVersion(): number {
    return (
      this.database.prepare('PRAGMA user_version;').get() as unknown as { user_version: number }
    ).user_version;
  }

  close(): void {
    this.database.close();
  }
}
