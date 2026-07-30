import { DatabaseSync } from 'node:sqlite';
import { eventEnvelopeSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';

export class EventDatabase {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec('PRAGMA synchronous = NORMAL;');
    this.database.exec(`
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
    `);
  }

  insertMany(events: readonly DevToolEventEnvelope[]): void {
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const insert = this.database.prepare(`
        INSERT OR IGNORE INTO events
          (id, session_id, device_id, timestamp, sequence, category, type, envelope_json)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?)
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
        );
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

  close(): void {
    this.database.close();
  }
}
