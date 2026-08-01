import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { z } from 'zod';
import { eventEnvelopeSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import type {
  EventAnnotation,
  EventBookmark,
  EventDatabase,
  StoredDevice,
  StoredSession,
} from './database.js';

export const SESSION_ARCHIVE_VERSION = 2;
const MAX_DECOMPRESSED_ARCHIVE_BYTES = 512 * 1024 * 1024;

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
  appVersion: z.string().max(256).optional(),
  sdkVersion: z.string().max(256).optional(),
  protocolVersion: z.string().max(256).optional(),
  endedAt: z.number().finite().nonnegative().optional(),
  connectionCount: z.number().int().nonnegative(),
  displayName: z.string().max(256).optional(),
  trustStatus: z.string().max(64).optional(),
  disconnectCode: z.number().int().nonnegative().optional(),
  disconnectReason: z.string().max(1_024).optional(),
});
const storedDeviceSchema = z.object({
  deviceId: z.string().trim().min(1).max(256),
  appId: z.string().trim().min(1).max(256),
  name: z.string().min(1).max(256),
  appName: z.string().min(1).max(256),
  platform: z.string().min(1).max(64),
  platformVersion: z.string().max(256).optional(),
  model: z.string().max(256).optional(),
  appVersion: z.string().max(256).optional(),
  sdkVersion: z.string().min(1).max(256),
  firstSeenAt: z.number().finite().nonnegative(),
  lastSeenAt: z.number().finite().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
});
const bookmarkSchema = z.object({
  id: z.string().trim().min(1).max(256),
  eventId: z.string().trim().min(1).max(256),
  sessionId: z.string().trim().min(1).max(256),
  label: z.string().max(256).optional(),
  createdAt: z.number().finite().nonnegative(),
});
const annotationSchema = z.object({
  id: z.string().trim().min(1).max(256),
  eventId: z.string().trim().min(1).max(256),
  sessionId: z.string().trim().min(1).max(256),
  body: z.string().min(1).max(10_000),
  createdAt: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
});

function checkedEntrySchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    data,
  });
}

export const sessionArchiveSchema = z
  .object({
    format: z.literal('pulse-rn-archive'),
    version: z.literal(SESSION_ARCHIVE_VERSION),
    manifest: z.object({
      archiveFormatVersion: z.literal(SESSION_ARCHIVE_VERSION),
      exportedAt: z.number().finite().nonnegative(),
      counts: z.object({
        sessions: z.number().int().nonnegative(),
        devices: z.number().int().nonnegative(),
        events: z.number().int().nonnegative(),
        bookmarks: z.number().int().nonnegative(),
        annotations: z.number().int().nonnegative(),
      }),
      redaction: z.object({
        capturedDataRedacted: z.literal(true),
        metadataIncluded: z.literal(true),
      }),
    }),
    sessions: z.array(checkedEntrySchema(storedSessionSchema)).min(1).max(500),
    devices: z.array(checkedEntrySchema(storedDeviceSchema)).max(1_000),
    events: z.array(checkedEntrySchema(eventEnvelopeSchema)).max(1_000_000),
    bookmarks: z.array(checkedEntrySchema(bookmarkSchema)).max(1_000_000),
    annotations: z.array(checkedEntrySchema(annotationSchema)).max(1_000_000),
  })
  .superRefine((archive, context) => {
    const collections = [
      archive.sessions,
      archive.devices,
      archive.events,
      archive.bookmarks,
      archive.annotations,
    ];
    for (const [collectionIndex, entries] of collections.entries()) {
      for (const [entryIndex, entry] of entries.entries()) {
        if (entry.checksum !== checksum(entry.data)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [collectionIndex, entryIndex, 'checksum'],
            message: 'Archive entry checksum does not match its data.',
          });
        }
      }
    }
    const counts = archive.manifest.counts;
    const actual = {
      sessions: archive.sessions.length,
      devices: archive.devices.length,
      events: archive.events.length,
      bookmarks: archive.bookmarks.length,
      annotations: archive.annotations.length,
    };
    for (const key of Object.keys(actual) as (keyof typeof actual)[]) {
      if (counts[key] !== actual[key]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['manifest', 'counts', key],
          message: 'Archive manifest count does not match its entries.',
        });
      }
    }
    const sessionIds = new Set(archive.sessions.map((entry) => entry.data.sessionId));
    const eventIds = new Set(archive.events.map((entry) => entry.data.id));
    for (const [index, entry] of archive.events.entries()) {
      if (!sessionIds.has(entry.data.sessionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['events', index, 'data', 'sessionId'],
          message: 'Event references a session not declared by the archive.',
        });
      }
    }
    for (const [collection, entries] of [
      ['bookmarks', archive.bookmarks],
      ['annotations', archive.annotations],
    ] as const) {
      for (const [index, entry] of entries.entries()) {
        if (!eventIds.has(entry.data.eventId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [collection, index, 'data', 'eventId'],
            message: 'Metadata references an event not declared by the archive.',
          });
        }
      }
    }
  });

export type SessionArchive = z.infer<typeof sessionArchiveSchema>;

function checksum(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function checked<T>(data: T): { checksum: string; data: T } {
  return { checksum: checksum(data), data };
}

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
  const sessionIds = new Set(sessions.map((session) => session.sessionId));
  const events = sessions.flatMap((session) => readSessionEvents(database, session.sessionId));
  const eventIds = new Set(events.map((event) => event.id));
  const devices = database
    .listDevices(500)
    .filter((device) =>
      sessions.some(
        (session) => session.deviceId === device.deviceId && session.appId === device.appId,
      ),
    );
  const bookmarks = database
    .listBookmarks()
    .filter((bookmark) => sessionIds.has(bookmark.sessionId) && eventIds.has(bookmark.eventId));
  const annotations = database
    .listAnnotations()
    .filter(
      (annotation) => sessionIds.has(annotation.sessionId) && eventIds.has(annotation.eventId),
    );
  return sessionArchiveSchema.parse({
    format: 'pulse-rn-archive',
    version: SESSION_ARCHIVE_VERSION,
    manifest: {
      archiveFormatVersion: SESSION_ARCHIVE_VERSION,
      exportedAt,
      counts: {
        sessions: sessions.length,
        devices: devices.length,
        events: events.length,
        bookmarks: bookmarks.length,
        annotations: annotations.length,
      },
      redaction: {
        capturedDataRedacted: true,
        metadataIncluded: true,
      },
    },
    sessions: sessions.map(checked),
    devices: devices.map(checked),
    events: events.map(checked),
    bookmarks: bookmarks.map(checked),
    annotations: annotations.map(checked),
  });
}

export function parseSessionArchive(value: unknown): SessionArchive {
  return sessionArchiveSchema.parse(value);
}

export function encodeSessionArchive(archive: SessionArchive): Buffer {
  const validated = sessionArchiveSchema.parse(archive);
  return gzipSync(Buffer.from(JSON.stringify(validated), 'utf8'), { level: 9 });
}

export function decodeSessionArchive(value: Buffer): SessionArchive {
  if (value.length < 2 || value[0] !== 0x1f || value[1] !== 0x8b) {
    throw new Error('Unsupported PulseRN archive encoding.');
  }
  const json = gunzipSync(value, { maxOutputLength: MAX_DECOMPRESSED_ARCHIVE_BYTES }).toString(
    'utf8',
  );
  return parseSessionArchive(JSON.parse(json) as unknown);
}

export function importSessionArchive(
  database: EventDatabase,
  archive: SessionArchive,
): { sessions: number; events: number } {
  const validated = sessionArchiveSchema.parse(archive);
  const sessions = validated.sessions.map((entry) => entry.data) as StoredSession[];
  const events = validated.events.map((entry) => entry.data) as DevToolEventEnvelope[];
  database.importSessionData(sessions, events, {
    devices: validated.devices.map((entry) => entry.data) as StoredDevice[],
    bookmarks: validated.bookmarks.map((entry) => entry.data) as EventBookmark[],
    annotations: validated.annotations.map((entry) => entry.data) as EventAnnotation[],
  });
  return { sessions: sessions.length, events: events.length };
}
