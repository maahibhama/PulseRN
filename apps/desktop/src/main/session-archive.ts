import { z } from 'zod';
import { eventEnvelopeSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import type { EventDatabase, StoredSession } from './database.js';

export const SESSION_ARCHIVE_VERSION = 1;
const storedSessionSchema = z.object({
  sessionId: z.string().trim().min(1).max(256),
  appId: z.string().trim().min(1).max(256),
  deviceId: z.string().trim().min(1).max(256),
  appName: z.string().min(1).max(256),
  deviceName: z.string().min(1).max(256),
  platform: z.string().min(1).max(64),
  startedAt: z.number().finite().nonnegative(),
  lastSeenAt: z.number().finite().nonnegative(),
  eventCount: z.number().int().nonnegative(),
});

export const sessionArchiveSchema = z
  .object({
    format: z.literal('pulse-rn-session'),
    version: z.literal(SESSION_ARCHIVE_VERSION),
    exportedAt: z.number().finite().nonnegative(),
    sessions: z.array(storedSessionSchema).min(1).max(500),
    events: z.array(eventEnvelopeSchema).max(1_000_000),
  })
  .superRefine((archive, context) => {
    const sessionIds = new Set(archive.sessions.map((session) => session.sessionId));
    for (const [index, event] of archive.events.entries()) {
      if (!sessionIds.has(event.sessionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['events', index, 'sessionId'],
          message: 'Event references a session not declared by the archive.',
        });
      }
    }
  });

export type SessionArchive = z.infer<typeof sessionArchiveSchema>;

function readSessionEvents(database: EventDatabase, sessionId: string): DevToolEventEnvelope[] {
  const events: DevToolEventEnvelope[] = [];
  let cursor;
  do {
    const page = database.query({ cursor, limit: 500, order: 'oldest', sessionId });
    events.push(...page.events);
    cursor = page.nextCursor;
  } while (cursor);
  return events;
}

export function createSessionArchive(
  database: EventDatabase,
  requestedSessionIds?: readonly string[],
  exportedAt = Date.now(),
): SessionArchive {
  const requested = requestedSessionIds ? new Set(requestedSessionIds) : undefined;
  const sessions = database
    .listSessions(500)
    .filter((session) => !requested || requested.has(session.sessionId));
  if (sessions.length === 0) throw new Error('No stored sessions matched the export request.');
  return sessionArchiveSchema.parse({
    format: 'pulse-rn-session',
    version: SESSION_ARCHIVE_VERSION,
    exportedAt,
    sessions,
    events: sessions.flatMap((session) => readSessionEvents(database, session.sessionId)),
  });
}

export function parseSessionArchive(value: unknown): SessionArchive {
  return sessionArchiveSchema.parse(value);
}

export function importSessionArchive(
  database: EventDatabase,
  archive: SessionArchive,
): { sessions: number; events: number } {
  const validated = sessionArchiveSchema.parse(archive);
  database.importSessionData(validated.sessions as StoredSession[], validated.events);
  return { sessions: validated.sessions.length, events: validated.events.length };
}
