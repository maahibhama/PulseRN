import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { eventEnvelopeSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import type { ConnectedDevice } from './session-manager.js';
import type { DisconnectInfo } from './session-manager.js';

const CURRENT_SCHEMA_VERSION = 7;

export interface EventCursor {
  timestamp: number;
  sequence: number;
  id: string;
}

export interface EventQuery {
  category?: DevToolEventEnvelope['category'];
  categories?: DevToolEventEnvelope['category'][];
  cursor?: EventCursor;
  direction?: 'forward' | 'backward';
  deviceId?: string;
  endTime?: number;
  errorsOnly?: boolean;
  correlationId?: string;
  limit?: number;
  order?: 'newest' | 'oldest';
  parentId?: string;
  sessionId?: string;
  startTime?: number;
  text?: string;
  type?: string;
  types?: string[];
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
  recovery?: DatabaseRecoveryReport;
}

export interface EventPage {
  events: DevToolEventEnvelope[];
  hasMore: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  nextCursor?: EventCursor;
  previousCursor?: EventCursor;
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
  appVersion?: string;
  sdkVersion?: string;
  protocolVersion?: string;
  endedAt?: number;
  connectionCount: number;
  displayName?: string;
  trustStatus?: string;
  disconnectCode?: number;
  disconnectReason?: string;
}

export interface StoredDevice {
  deviceId: string;
  appId: string;
  name: string;
  appName: string;
  platform: string;
  platformVersion?: string;
  model?: string;
  appVersion?: string;
  sdkVersion: string;
  firstSeenAt: number;
  lastSeenAt: number;
  sessionCount: number;
}

export interface StoredRetentionState {
  maxAgeDays: number;
  maxEvents: number;
  lastRunAt: number;
}

export interface SavedEventFilter {
  id: string;
  name: string;
  query: Omit<EventQuery, 'cursor' | 'direction' | 'limit'>;
  createdAt: number;
  updatedAt: number;
}

export interface EventBookmark {
  id: string;
  eventId: string;
  sessionId: string;
  label?: string;
  createdAt: number;
}

export interface EventAnnotation {
  id: string;
  eventId: string;
  sessionId: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface StorageAuditRecord {
  id: string;
  connectionId: string;
  providerId: string;
  key: string;
  operation: 'set' | 'delete' | 'restore';
  success: boolean;
  createdAt: number;
  backupId?: string;
  error?: string;
}

export interface StorageSnapshotRecord {
  id: string;
  connectionId: string;
  providerId: string;
  key: string;
  value: string;
  valueType: 'string' | 'number' | 'boolean' | 'json' | 'binary' | 'unknown';
  valueSize: number;
  createdAt: number;
}

export interface DatabaseRecoveryReport {
  status: 'not-needed' | 'recovered';
  backupPath?: string;
  recoveredEvents: number;
  recoveredSessions: number;
  lostEvents: number;
  lossesUnknown: boolean;
  reason?: string;
}

class FutureSchemaVersionError extends Error {}

class DatabaseIntegrityError extends Error {}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

interface SalvagedData {
  events: DevToolEventEnvelope[];
  sessions: StoredSession[];
  observedEventRows: number;
  scanComplete: boolean;
}

export class EventDatabase {
  private database!: DatabaseSync;
  private recovery: DatabaseRecoveryReport = {
    status: 'not-needed',
    recoveredEvents: 0,
    recoveredSessions: 0,
    lostEvents: 0,
    lossesUnknown: false,
  };

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    try {
      this.database = this.open(path);
      this.assertIntegrity();
    } catch (error) {
      try {
        this.database?.close();
      } catch {
        // The failed database handle may already be unusable.
      }
      this.recover(error);
      return;
    }
    try {
      this.migrate();
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  private open(path: string): DatabaseSync {
    const database = new DatabaseSync(path);
    database.exec('PRAGMA journal_mode = WAL;');
    database.exec('PRAGMA synchronous = NORMAL;');
    database.exec('PRAGMA foreign_keys = ON;');
    return database;
  }

  private assertIntegrity(): void {
    const rows = this.database.prepare('PRAGMA quick_check;').all() as unknown as {
      quick_check: string;
    }[];
    if (rows.length !== 1 || rows[0]?.quick_check !== 'ok') {
      throw new DatabaseIntegrityError(
        rows.map((row) => row.quick_check).join('; ') || 'SQLite quick_check failed.',
      );
    }
  }

  private migrate(): void {
    const version = (
      this.database.prepare('PRAGMA user_version;').get() as unknown as { user_version: number }
    ).user_version;
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new FutureSchemaVersionError(
        `PulseRN database schema ${version} is newer than supported schema ${CURRENT_SCHEMA_VERSION}.`,
      );
    }
    for (let target = version + 1; target <= CURRENT_SCHEMA_VERSION; target += 1) {
      this.applyMigration(target);
    }
  }

  private applyMigration(version: number): void {
    const migrations: Record<number, string> = {
      1: `
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
      `,
      2: `
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
      `,
      3: `
        CREATE TABLE IF NOT EXISTS devices (
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
        CREATE INDEX IF NOT EXISTS idx_devices_last_seen
          ON devices(last_seen_at DESC);
        CREATE INDEX IF NOT EXISTS idx_events_session_cursor
          ON events(session_id, timestamp, sequence, id);
        CREATE INDEX IF NOT EXISTS idx_events_device_cursor
          ON events(device_id, timestamp, sequence, id);
        CREATE INDEX IF NOT EXISTS idx_events_category_cursor
          ON events(category, timestamp, sequence, id);
        CREATE INDEX IF NOT EXISTS idx_events_time_cursor
          ON events(timestamp, sequence, id);
      `,
      4: `
        ALTER TABLE sessions ADD COLUMN app_version TEXT;
        ALTER TABLE sessions ADD COLUMN sdk_version TEXT;
        ALTER TABLE sessions ADD COLUMN protocol_version TEXT;
        ALTER TABLE sessions ADD COLUMN ended_at INTEGER;
        ALTER TABLE sessions ADD COLUMN connection_count INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE IF NOT EXISTS retention_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          max_age_days INTEGER NOT NULL,
          max_events INTEGER NOT NULL,
          last_run_at INTEGER NOT NULL
        );
      `,
      5: `
        ALTER TABLE sessions ADD COLUMN display_name TEXT;
        ALTER TABLE sessions ADD COLUMN trust_status TEXT;
        ALTER TABLE sessions ADD COLUMN disconnect_code INTEGER;
        ALTER TABLE sessions ADD COLUMN disconnect_reason TEXT;
        CREATE INDEX IF NOT EXISTS idx_sessions_device_last_seen
          ON sessions(device_id, last_seen_at DESC);
      `,
      6: `
        ALTER TABLE events ADD COLUMN correlation_id TEXT;
        ALTER TABLE events ADD COLUMN parent_id TEXT;
        UPDATE events
        SET correlation_id = json_extract(envelope_json, '$.correlationId'),
            parent_id = json_extract(envelope_json, '$.parentId')
        WHERE json_valid(envelope_json);
        CREATE INDEX IF NOT EXISTS idx_events_type_cursor
          ON events(type, timestamp, sequence, id);
        CREATE INDEX IF NOT EXISTS idx_events_correlation_cursor
          ON events(correlation_id, timestamp, sequence, id);
        CREATE INDEX IF NOT EXISTS idx_events_parent_cursor
          ON events(parent_id, timestamp, sequence, id);
        CREATE TABLE saved_event_filters (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          query_json TEXT NOT NULL CHECK (json_valid(query_json)),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_saved_event_filters_updated
          ON saved_event_filters(updated_at DESC);
        CREATE TABLE event_bookmarks (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL UNIQUE,
          session_id TEXT NOT NULL,
          label TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_event_bookmarks_session
          ON event_bookmarks(session_id, created_at DESC);
        CREATE TABLE event_annotations (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_event_annotations_event
          ON event_annotations(event_id, updated_at DESC);
        CREATE INDEX idx_event_annotations_session
          ON event_annotations(session_id, updated_at DESC);
      `,
      7: `
        CREATE TABLE storage_audit (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          storage_key TEXT NOT NULL,
          operation TEXT NOT NULL CHECK (operation IN ('set', 'delete', 'restore')),
          backup_id TEXT,
          success INTEGER NOT NULL CHECK (success IN (0, 1)),
          error TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_storage_audit_created
          ON storage_audit(created_at DESC);
        CREATE INDEX idx_storage_audit_provider_key
          ON storage_audit(provider_id, storage_key, created_at DESC);
        CREATE TABLE storage_snapshots (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          storage_key TEXT NOT NULL,
          value TEXT NOT NULL,
          value_type TEXT NOT NULL,
          value_size INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_storage_snapshots_provider_key
          ON storage_snapshots(provider_id, storage_key, created_at DESC);
      `,
    };
    const sql = migrations[version];
    if (!sql) throw new Error(`Missing PulseRN database migration ${version}.`);
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL,
          description TEXT NOT NULL
        );
      `);
      const existingVersion = (
        this.database.prepare('PRAGMA user_version;').get() as unknown as {
          user_version: number;
        }
      ).user_version;
      const record = this.database.prepare(
        'INSERT OR IGNORE INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
      );
      for (let historical = 1; historical <= existingVersion; historical += 1) {
        record.run(historical, Date.now(), 'Imported schema history');
      }
      this.database.exec(sql);
      record.run(version, Date.now(), `PulseRN schema ${version}`);
      this.database.exec(`PRAGMA user_version = ${version};`);
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  private recover(cause: unknown): void {
    const salvage = this.salvage();
    const suffix = new Date().toISOString().replaceAll(/[:.]/g, '-');
    const backupPath = `${this.path}.corrupt-${suffix}`;
    for (const extension of ['', '-wal', '-shm']) {
      const source = `${this.path}${extension}`;
      if (!existsSync(source)) continue;
      const destination = `${backupPath}${extension}`;
      try {
        renameSync(source, destination);
      } catch {
        copyFileSync(source, destination);
        rmSync(source, { force: true });
      }
    }
    this.database = this.open(this.path);
    this.migrate();
    if (salvage.sessions.length > 0) {
      this.importSessionData(salvage.sessions, salvage.events);
    } else if (salvage.events.length > 0) {
      this.insertMany(salvage.events);
    }
    this.recovery = {
      status: 'recovered',
      backupPath,
      recoveredEvents: salvage.events.length,
      recoveredSessions: salvage.sessions.length,
      lostEvents: Math.max(0, salvage.observedEventRows - salvage.events.length),
      lossesUnknown: !salvage.scanComplete,
      reason: cause instanceof Error ? cause.message : 'Unknown database integrity failure.',
    };
  }

  private salvage(): SalvagedData {
    const result: SalvagedData = {
      events: [],
      sessions: [],
      observedEventRows: 0,
      scanComplete: false,
    };
    if (!existsSync(this.path)) return result;
    let source: DatabaseSync | undefined;
    try {
      source = new DatabaseSync(this.path, { readOnly: true });
      const eventRows = source.prepare('SELECT envelope_json FROM events').all() as unknown as {
        envelope_json: string;
      }[];
      result.observedEventRows = eventRows.length;
      result.scanComplete = true;
      result.events = eventRows.flatMap((row) => {
        try {
          const parsed = eventEnvelopeSchema.safeParse(JSON.parse(row.envelope_json) as unknown);
          return parsed.success ? [parsed.data] : [];
        } catch {
          return [];
        }
      });
      const table = source
        .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
        .get() as unknown as { found: number } | undefined;
      if (table) {
        const rows = source
          .prepare(
            `
              SELECT
                session_id AS sessionId, app_id AS appId, device_id AS deviceId,
                app_name AS appName, device_name AS deviceName, platform,
                started_at AS startedAt, last_seen_at AS lastSeenAt,
                event_count AS eventCount
              FROM sessions
            `,
          )
          .all() as unknown as StoredSession[];
        result.sessions = rows.map((session) => ({ ...session, connectionCount: 0 }));
      }
    } catch {
      // A severely damaged file may not expose any readable rows.
    } finally {
      try {
        source?.close();
      } catch {
        // Ignore cleanup errors from a corrupt handle.
      }
    }
    return result;
  }

  recordSession(device: ConnectedDevice): void {
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database
        .prepare(
          `
          INSERT INTO devices (
            device_id, app_id, name, app_name, platform, platform_version, model,
            app_version, sdk_version, first_seen_at, last_seen_at, session_count
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(device_id, app_id) DO UPDATE SET
            name = excluded.name,
            app_name = excluded.app_name,
            platform = excluded.platform,
            platform_version = excluded.platform_version,
            model = excluded.model,
            app_version = excluded.app_version,
            sdk_version = excluded.sdk_version,
            last_seen_at = MAX(devices.last_seen_at, excluded.last_seen_at),
            session_count = devices.session_count + CASE
              WHEN NOT EXISTS (
                SELECT 1 FROM sessions
                WHERE sessions.device_id = excluded.device_id
                  AND sessions.app_id = excluded.app_id
                  AND sessions.session_id = ?
              ) THEN 1 ELSE 0 END
        `,
        )
        .run(
          device.deviceId,
          device.appId,
          device.device.name,
          device.device.appName,
          device.device.platform,
          device.device.platformVersion ?? null,
          device.device.model ?? null,
          device.device.appVersion ?? null,
          device.device.sdkVersion,
          device.connectedAt,
          device.connectedAt,
          device.sessionId,
        );
      this.database
        .prepare(
          `
          INSERT INTO sessions (
            session_id, app_id, device_id, app_name, device_name, platform,
            started_at, last_seen_at, event_count, app_version, sdk_version,
            protocol_version, ended_at, connection_count, trust_status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, 1, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            app_id = excluded.app_id,
            device_id = excluded.device_id,
            app_name = excluded.app_name,
            device_name = excluded.device_name,
            platform = excluded.platform,
            app_version = excluded.app_version,
            sdk_version = excluded.sdk_version,
            protocol_version = excluded.protocol_version,
            trust_status = excluded.trust_status,
            last_seen_at = MAX(sessions.last_seen_at, excluded.last_seen_at),
            ended_at = NULL,
            disconnect_code = NULL,
            disconnect_reason = NULL,
            connection_count = sessions.connection_count + 1
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
          device.device.appVersion ?? null,
          device.device.sdkVersion,
          device.protocolVersion ?? null,
          device.trustStatus ?? null,
        );
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  endSession(sessionId: string, info?: DisconnectInfo | number): void {
    const endedAt = typeof info === 'number' ? info : (info?.disconnectedAt ?? Date.now());
    this.database
      .prepare(
        `
          UPDATE sessions
          SET ended_at = ?,
              last_seen_at = MAX(last_seen_at, ?),
              disconnect_code = ?,
              disconnect_reason = ?
          WHERE session_id = ?
        `,
      )
      .run(
        endedAt,
        endedAt,
        typeof info === 'number' ? null : (info?.code ?? null),
        typeof info === 'number' ? null : (info?.reason ?? null),
        sessionId,
      );
  }

  insertMany(events: readonly DevToolEventEnvelope[]): void {
    if (events.length === 0) return;
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const insert = this.database.prepare(`
        INSERT OR IGNORE INTO events
          (
            id, session_id, device_id, timestamp, sequence, category, type,
            envelope_json, correlation_id, parent_id
          )
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          event.correlationId ?? null,
          event.parentId ?? null,
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
    const direction = input.direction ?? 'forward';
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
    if (input.type) {
      filters.push('type = ?');
      filterValues.push(input.type);
    }
    if (input.types?.length) {
      const types = [...new Set(input.types)];
      filters.push(`type IN (${types.map(() => '?').join(', ')})`);
      filterValues.push(...types);
    }
    if (input.startTime !== undefined) {
      filters.push('timestamp >= ?');
      filterValues.push(input.startTime);
    }
    if (input.endTime !== undefined) {
      filters.push('timestamp <= ?');
      filterValues.push(input.endTime);
    }
    if (input.correlationId) {
      filters.push('correlation_id = ?');
      filterValues.push(input.correlationId);
    }
    if (input.parentId) {
      filters.push('parent_id = ?');
      filterValues.push(input.parentId);
    }
    if (input.errorsOnly) {
      filters.push("category = 'error'");
    }
    if (input.text?.trim()) {
      filters.push("LOWER(envelope_json) LIKE ? ESCAPE '\\'");
      filterValues.push(`%${escapeLike(input.text.trim().toLowerCase())}%`);
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
    const forwardOperator = order === 'newest' ? '<' : '>';
    const cursorOperator =
      direction === 'forward' ? forwardOperator : forwardOperator === '<' ? '>' : '<';
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
    const requestedDirection =
      direction === 'forward'
        ? order === 'newest'
          ? 'DESC'
          : 'ASC'
        : order === 'newest'
          ? 'ASC'
          : 'DESC';
    const rows = this.database
      .prepare(
        `
          SELECT id, timestamp, sequence, envelope_json
          FROM events
          ${pageWhere}
          ORDER BY timestamp ${requestedDirection},
                   sequence ${requestedDirection},
                   id ${requestedDirection}
          LIMIT ?
        `,
      )
      .all(...pageValues) as unknown as {
      id: string;
      timestamp: number;
      sequence: number;
      envelope_json: string;
    }[];
    const visibleRows = rows.length > limit ? rows.slice(0, limit) : rows;
    if (direction === 'backward') visibleRows.reverse();
    const events = visibleRows.flatMap((row) => {
      try {
        const result = eventEnvelopeSchema.safeParse(JSON.parse(row.envelope_json) as unknown);
        return result.success ? [result.data] : [];
      } catch {
        return [];
      }
    });
    const first = visibleRows[0];
    const last = visibleRows.at(-1);
    const totalRow = this.database
      .prepare(`SELECT COUNT(*) AS count FROM events ${baseWhere}`)
      .get(...filterValues) as unknown as { count: number };
    const hasPrevious = first
      ? this.hasRelativeRow(baseWhere, filterValues, first, forwardOperator === '<' ? '>' : '<')
      : false;
    const hasNext = last
      ? this.hasRelativeRow(baseWhere, filterValues, last, forwardOperator)
      : false;
    return {
      events,
      hasMore: hasNext,
      hasNext,
      hasPrevious,
      total: totalRow.count,
      ...(hasNext && last
        ? {
            nextCursor: {
              id: last.id,
              sequence: last.sequence,
              timestamp: last.timestamp,
            },
          }
        : {}),
      ...(hasPrevious && first
        ? {
            previousCursor: {
              id: first.id,
              sequence: first.sequence,
              timestamp: first.timestamp,
            },
          }
        : {}),
    };
  }

  private hasRelativeRow(
    baseWhere: string,
    filterValues: readonly (number | string)[],
    cursor: EventCursor,
    operator: '<' | '>',
  ): boolean {
    const where = `${baseWhere.length === 0 ? 'WHERE' : `${baseWhere} AND`} (
      timestamp ${operator} ?
      OR (timestamp = ? AND sequence ${operator} ?)
      OR (timestamp = ? AND sequence = ? AND id ${operator} ?)
    )`;
    const row = this.database
      .prepare(`SELECT 1 AS found FROM events ${where} LIMIT 1`)
      .get(
        ...filterValues,
        cursor.timestamp,
        cursor.timestamp,
        cursor.sequence,
        cursor.timestamp,
        cursor.sequence,
        cursor.id,
      ) as unknown as { found: number } | undefined;
    return row?.found === 1;
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

  listSavedFilters(): SavedEventFilter[] {
    return this.database
      .prepare(
        `
          SELECT id, name, query_json AS queryJson, created_at AS createdAt,
                 updated_at AS updatedAt
          FROM saved_event_filters
          ORDER BY updated_at DESC, name ASC
        `,
      )
      .all()
      .flatMap((row) => {
        const value = row as unknown as {
          id: string;
          name: string;
          queryJson: string;
          createdAt: number;
          updatedAt: number;
        };
        try {
          return [
            {
              id: value.id,
              name: value.name,
              query: JSON.parse(value.queryJson) as SavedEventFilter['query'],
              createdAt: value.createdAt,
              updatedAt: value.updatedAt,
            },
          ];
        } catch {
          return [];
        }
      });
  }

  saveFilter(
    name: string,
    query: SavedEventFilter['query'],
    id: string = randomUUID(),
    now = Date.now(),
  ): SavedEventFilter {
    const normalizedName = name.trim();
    if (normalizedName.length < 1 || normalizedName.length > 128) {
      throw new Error('Saved filter names must contain between 1 and 128 characters.');
    }
    this.database
      .prepare(
        `
          INSERT INTO saved_event_filters (id, name, query_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            query_json = excluded.query_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(id, normalizedName, JSON.stringify(query), now, now);
    return this.listSavedFilters().find((filter) => filter.id === id)!;
  }

  deleteSavedFilter(id: string): boolean {
    return (
      this.database.prepare('DELETE FROM saved_event_filters WHERE id = ?').run(id).changes > 0
    );
  }

  listBookmarks(sessionId?: string): EventBookmark[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, event_id AS eventId, session_id AS sessionId, label,
                 created_at AS createdAt
          FROM event_bookmarks
          ${sessionId ? 'WHERE session_id = ?' : ''}
          ORDER BY created_at DESC
        `,
      )
      .all(...(sessionId ? [sessionId] : [])) as unknown as (EventBookmark & {
      label: string | null;
    })[];
    return rows.map((bookmark) => ({
      ...bookmark,
      label: bookmark.label ?? undefined,
    }));
  }

  addBookmark(
    eventId: string,
    label?: string,
    id: string = randomUUID(),
    createdAt = Date.now(),
  ): EventBookmark {
    const event = this.findById(eventId);
    if (!event) throw new Error('The selected event does not exist.');
    const normalizedLabel = label?.trim();
    if (normalizedLabel && normalizedLabel.length > 256) {
      throw new Error('Bookmark labels cannot exceed 256 characters.');
    }
    this.database
      .prepare(
        `
          INSERT INTO event_bookmarks (id, event_id, session_id, label, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(event_id) DO UPDATE SET label = excluded.label
        `,
      )
      .run(id, eventId, event.sessionId, normalizedLabel || null, createdAt);
    return this.listBookmarks(event.sessionId).find((bookmark) => bookmark.eventId === eventId)!;
  }

  deleteBookmark(id: string): boolean {
    return this.database.prepare('DELETE FROM event_bookmarks WHERE id = ?').run(id).changes > 0;
  }

  listAnnotations(eventId?: string, sessionId?: string): EventAnnotation[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (eventId) {
      clauses.push('event_id = ?');
      values.push(eventId);
    }
    if (sessionId) {
      clauses.push('session_id = ?');
      values.push(sessionId);
    }
    return this.database
      .prepare(
        `
          SELECT id, event_id AS eventId, session_id AS sessionId, body,
                 created_at AS createdAt, updated_at AS updatedAt
          FROM event_annotations
          ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
          ORDER BY updated_at DESC
        `,
      )
      .all(...values) as unknown as EventAnnotation[];
  }

  saveAnnotation(
    eventId: string,
    body: string,
    id: string = randomUUID(),
    now = Date.now(),
  ): EventAnnotation {
    const event = this.findById(eventId);
    if (!event) throw new Error('The selected event does not exist.');
    const normalizedBody = body.trim();
    if (normalizedBody.length < 1 || normalizedBody.length > 10_000) {
      throw new Error('Annotations must contain between 1 and 10,000 characters.');
    }
    this.database
      .prepare(
        `
          INSERT INTO event_annotations (
            id, event_id, session_id, body, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            body = excluded.body,
            updated_at = excluded.updated_at
        `,
      )
      .run(id, eventId, event.sessionId, normalizedBody, now, now);
    return this.listAnnotations(eventId).find((annotation) => annotation.id === id)!;
  }

  deleteAnnotation(id: string): boolean {
    return this.database.prepare('DELETE FROM event_annotations WHERE id = ?').run(id).changes > 0;
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
      this.database
        .prepare(
          `
            INSERT INTO retention_state (id, max_age_days, max_events, last_run_at)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              max_age_days = excluded.max_age_days,
              max_events = excluded.max_events,
              last_run_at = excluded.last_run_at
          `,
        )
        .run(maxAgeDays, maxEvents, now);
      this.database.exec('COMMIT;');
      return {
        integrity: invalid > 0 ? 'recovered' : 'ok',
        removedExpired: Number(expired),
        removedOverflow: Number(overflow),
        removedInvalid: Number(invalid),
        retainedEvents: retained,
        completedAt: now,
        ...(this.recovery.status === 'recovered' ? { recovery: this.recovery } : {}),
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
            event_count AS eventCount,
            app_version AS appVersion,
            sdk_version AS sdkVersion,
            protocol_version AS protocolVersion,
            ended_at AS endedAt,
            connection_count AS connectionCount,
            display_name AS displayName,
            trust_status AS trustStatus,
            disconnect_code AS disconnectCode,
            disconnect_reason AS disconnectReason
          FROM sessions
          ORDER BY last_seen_at DESC
          LIMIT ?
        `,
      )
      .all(safeLimit)
      .map((row) => {
        const session = row as unknown as StoredSession & {
          appVersion: string | null;
          sdkVersion: string | null;
          protocolVersion: string | null;
          endedAt: number | null;
          displayName: string | null;
          trustStatus: string | null;
          disconnectCode: number | null;
          disconnectReason: string | null;
        };
        return {
          ...session,
          appVersion: session.appVersion ?? undefined,
          sdkVersion: session.sdkVersion ?? undefined,
          protocolVersion: session.protocolVersion ?? undefined,
          endedAt: session.endedAt ?? undefined,
          displayName: session.displayName ?? undefined,
          trustStatus: session.trustStatus ?? undefined,
          disconnectCode: session.disconnectCode ?? undefined,
          disconnectReason: session.disconnectReason ?? undefined,
        };
      });
  }

  renameSession(sessionId: string, displayName: string): StoredSession {
    const name = displayName.trim();
    if (name.length < 1 || name.length > 256) {
      throw new Error('Session names must contain between 1 and 256 characters.');
    }
    const result = this.database
      .prepare('UPDATE sessions SET display_name = ? WHERE session_id = ?')
      .run(name, sessionId);
    if (result.changes !== 1) throw new Error('The selected session does not exist.');
    return this.listSessions(500).find((session) => session.sessionId === sessionId)!;
  }

  deleteSession(sessionId: string): { sessions: number; events: number } {
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const events = this.database
        .prepare('DELETE FROM events WHERE session_id = ?')
        .run(sessionId).changes;
      const sessions = this.database
        .prepare('DELETE FROM sessions WHERE session_id = ?')
        .run(sessionId).changes;
      this.database.exec('COMMIT;');
      return { sessions: Number(sessions), events: Number(events) };
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  listDevices(limit = 100): StoredDevice[] {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    return this.database
      .prepare(
        `
          SELECT
            device_id AS deviceId,
            app_id AS appId,
            name,
            app_name AS appName,
            platform,
            platform_version AS platformVersion,
            model,
            app_version AS appVersion,
            sdk_version AS sdkVersion,
            first_seen_at AS firstSeenAt,
            last_seen_at AS lastSeenAt,
            session_count AS sessionCount
          FROM devices
          ORDER BY last_seen_at DESC
          LIMIT ?
        `,
      )
      .all(safeLimit)
      .map((row) => {
        const device = row as unknown as StoredDevice & {
          platformVersion: string | null;
          model: string | null;
          appVersion: string | null;
        };
        return {
          ...device,
          platformVersion: device.platformVersion ?? undefined,
          model: device.model ?? undefined,
          appVersion: device.appVersion ?? undefined,
        };
      });
  }

  retentionState(): StoredRetentionState | undefined {
    return this.database
      .prepare(
        `
          SELECT
            max_age_days AS maxAgeDays,
            max_events AS maxEvents,
            last_run_at AS lastRunAt
          FROM retention_state
          WHERE id = 1
        `,
      )
      .get() as unknown as StoredRetentionState | undefined;
  }

  migrationHistory(): { version: number; appliedAt: number; description: string }[] {
    return this.database
      .prepare(
        `
          SELECT version, applied_at AS appliedAt, description
          FROM schema_migrations
          ORDER BY version
        `,
      )
      .all() as unknown as { version: number; appliedAt: number; description: string }[];
  }

  recoveryReport(): DatabaseRecoveryReport {
    return { ...this.recovery };
  }

  recordStorageAudit(
    input: Omit<StorageAuditRecord, 'id' | 'createdAt'> & {
      id?: string;
      createdAt?: number;
    },
  ): StorageAuditRecord {
    const record: StorageAuditRecord = {
      id: input.id ?? randomUUID(),
      connectionId: input.connectionId,
      providerId: input.providerId,
      key: input.key,
      operation: input.operation,
      success: input.success,
      createdAt: input.createdAt ?? Date.now(),
      ...(input.backupId ? { backupId: input.backupId } : {}),
      ...(input.error ? { error: input.error } : {}),
    };
    this.database
      .prepare(
        `
          INSERT INTO storage_audit (
            id, connection_id, provider_id, storage_key, operation, backup_id,
            success, error, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        record.id,
        record.connectionId,
        record.providerId,
        record.key,
        record.operation,
        record.backupId ?? null,
        record.success ? 1 : 0,
        record.error ?? null,
        record.createdAt,
      );
    return record;
  }

  listStorageAudit(limit = 100): StorageAuditRecord[] {
    return this.database
      .prepare(
        `
          SELECT
            id, connection_id AS connectionId, provider_id AS providerId,
            storage_key AS key, operation, backup_id AS backupId,
            success, error, created_at AS createdAt
          FROM storage_audit
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(Math.min(500, Math.max(1, limit)))
      .map((row) => {
        const record = row as unknown as Omit<
          StorageAuditRecord,
          'success' | 'backupId' | 'error'
        > & {
          success: number;
          backupId: string | null;
          error: string | null;
        };
        return {
          id: record.id,
          connectionId: record.connectionId,
          providerId: record.providerId,
          key: record.key,
          operation: record.operation,
          success: record.success === 1,
          createdAt: record.createdAt,
          ...(record.backupId ? { backupId: record.backupId } : {}),
          ...(record.error ? { error: record.error } : {}),
        };
      });
  }

  saveStorageSnapshot(
    input: Omit<StorageSnapshotRecord, 'id' | 'createdAt'> & {
      id?: string;
      createdAt?: number;
    },
  ): StorageSnapshotRecord {
    const snapshot: StorageSnapshotRecord = {
      ...input,
      id: input.id ?? randomUUID(),
      createdAt: input.createdAt ?? Date.now(),
    };
    this.database
      .prepare(
        `
          INSERT INTO storage_snapshots (
            id, connection_id, provider_id, storage_key, value, value_type,
            value_size, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        snapshot.id,
        snapshot.connectionId,
        snapshot.providerId,
        snapshot.key,
        snapshot.value,
        snapshot.valueType,
        snapshot.valueSize,
        snapshot.createdAt,
      );
    return snapshot;
  }

  listStorageSnapshots(providerId?: string, key?: string): StorageSnapshotRecord[] {
    const conditions: string[] = [];
    const values: string[] = [];
    if (providerId) {
      conditions.push('provider_id = ?');
      values.push(providerId);
    }
    if (key) {
      conditions.push('storage_key = ?');
      values.push(key);
    }
    return this.database
      .prepare(
        `
          SELECT
            id, connection_id AS connectionId, provider_id AS providerId,
            storage_key AS key, value, value_type AS valueType,
            value_size AS valueSize, created_at AS createdAt
          FROM storage_snapshots
          ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
          ORDER BY created_at DESC, id DESC
          LIMIT 500
        `,
      )
      .all(...values) as unknown as StorageSnapshotRecord[];
  }

  deleteStorageSnapshot(id: string): boolean {
    return this.database.prepare('DELETE FROM storage_snapshots WHERE id = ?').run(id).changes > 0;
  }

  importSessionData(
    sessions: readonly StoredSession[],
    events: readonly DevToolEventEnvelope[],
    metadata: {
      devices?: readonly StoredDevice[];
      bookmarks?: readonly EventBookmark[];
      annotations?: readonly EventAnnotation[];
    } = {},
  ): void {
    if (sessions.length === 0) return;
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const upsert = this.database.prepare(`
        INSERT INTO sessions (
          session_id, app_id, device_id, app_name, device_name, platform,
          started_at, last_seen_at, event_count, app_version, sdk_version,
          protocol_version, ended_at, connection_count, display_name, trust_status,
          disconnect_code, disconnect_reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          app_id = excluded.app_id,
          device_id = excluded.device_id,
          app_name = excluded.app_name,
          device_name = excluded.device_name,
          platform = excluded.platform,
          app_version = excluded.app_version,
          sdk_version = excluded.sdk_version,
          protocol_version = excluded.protocol_version,
          ended_at = excluded.ended_at,
          connection_count = MAX(sessions.connection_count, excluded.connection_count),
          display_name = COALESCE(excluded.display_name, sessions.display_name),
          trust_status = COALESCE(excluded.trust_status, sessions.trust_status),
          disconnect_code = excluded.disconnect_code,
          disconnect_reason = excluded.disconnect_reason,
          started_at = MIN(sessions.started_at, excluded.started_at),
          last_seen_at = MAX(sessions.last_seen_at, excluded.last_seen_at)
      `);
      for (const session of sessions) {
        upsert.run(
          session.sessionId,
          session.appId,
          session.deviceId,
          session.appName,
          session.deviceName,
          session.platform,
          session.startedAt,
          session.lastSeenAt,
          session.appVersion ?? null,
          session.sdkVersion ?? null,
          session.protocolVersion ?? null,
          session.endedAt ?? null,
          session.connectionCount,
          session.displayName ?? null,
          session.trustStatus ?? null,
          session.disconnectCode ?? null,
          session.disconnectReason ?? null,
        );
      }
      const insert = this.database.prepare(`
        INSERT OR IGNORE INTO events
          (
            id, session_id, device_id, timestamp, sequence, category, type,
            envelope_json, correlation_id, parent_id
          )
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const event of events) {
        insert.run(
          event.id,
          event.sessionId,
          event.deviceId,
          event.timestamp,
          event.sequence,
          event.category,
          event.type,
          JSON.stringify(event),
          event.correlationId ?? null,
          event.parentId ?? null,
        );
      }
      const upsertDevice = this.database.prepare(`
        INSERT INTO devices (
          device_id, app_id, name, app_name, platform, platform_version, model,
          app_version, sdk_version, first_seen_at, last_seen_at, session_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id, app_id) DO UPDATE SET
          name = excluded.name,
          app_name = excluded.app_name,
          platform = excluded.platform,
          platform_version = excluded.platform_version,
          model = excluded.model,
          app_version = excluded.app_version,
          sdk_version = excluded.sdk_version,
          first_seen_at = MIN(devices.first_seen_at, excluded.first_seen_at),
          last_seen_at = MAX(devices.last_seen_at, excluded.last_seen_at),
          session_count = MAX(devices.session_count, excluded.session_count)
      `);
      for (const device of metadata.devices ?? []) {
        upsertDevice.run(
          device.deviceId,
          device.appId,
          device.name,
          device.appName,
          device.platform,
          device.platformVersion ?? null,
          device.model ?? null,
          device.appVersion ?? null,
          device.sdkVersion,
          device.firstSeenAt,
          device.lastSeenAt,
          device.sessionCount,
        );
      }
      const insertBookmark = this.database.prepare(`
        INSERT OR REPLACE INTO event_bookmarks (
          id, event_id, session_id, label, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `);
      for (const bookmark of metadata.bookmarks ?? []) {
        insertBookmark.run(
          bookmark.id,
          bookmark.eventId,
          bookmark.sessionId,
          bookmark.label ?? null,
          bookmark.createdAt,
        );
      }
      const insertAnnotation = this.database.prepare(`
        INSERT OR REPLACE INTO event_annotations (
          id, event_id, session_id, body, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const annotation of metadata.annotations ?? []) {
        insertAnnotation.run(
          annotation.id,
          annotation.eventId,
          annotation.sessionId,
          annotation.body,
          annotation.createdAt,
          annotation.updatedAt,
        );
      }
      this.refreshSessionCounts();
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
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
