import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { EventDatabase } from './database.js';
import {
  createSessionArchive,
  decodeSessionArchive,
  encodeSessionArchive,
  importSessionArchive,
  parseSessionArchive,
} from './session-archive.js';

const directories: string[] = [];

function database(): EventDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-archive-'));
  directories.push(directory);
  return new EventDatabase(join(directory, 'archive.sqlite'));
}

function seed(target: EventDatabase): DevToolEventEnvelope {
  target.recordSession({
    connectionId: 'connection-1',
    sessionId: 'session-1',
    deviceId: 'device-1',
    appId: 'app-1',
    connectedAt: 1_000,
    device: {
      name: 'iPhone',
      appName: 'Archive example',
      platform: 'ios',
      sdkVersion: '0.2.1',
    },
  });
  const event = {
    id: 'archive-event-1',
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 'session-1',
    deviceId: 'device-1',
    appId: 'app-1',
    timestamp: 1_001,
    sequence: 1,
    category: 'console',
    type: 'console.log',
    payload: { level: 'log', arguments: ['hello'], message: 'hello' },
  } satisfies DevToolEventEnvelope;
  target.insertMany([event]);
  return event;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('session archives', () => {
  it('exports, validates, and imports a versioned session without double counting', () => {
    const source = database();
    const event = seed(source);
    const archive = createSessionArchive(source, ['session-1'], 2_000);

    expect(archive).toMatchObject({
      format: 'pulse-rn-archive',
      version: 2,
      manifest: {
        exportedAt: 2_000,
        counts: { sessions: 1, events: 1 },
      },
      sessions: [{ data: { sessionId: 'session-1', eventCount: 1 } }],
      events: [{ data: event }],
    });
    expect(decodeSessionArchive(encodeSessionArchive(archive))).toEqual(archive);

    const destination = database();
    expect(importSessionArchive(destination, archive)).toEqual({ sessions: 1, events: 1 });
    importSessionArchive(destination, archive);
    expect(destination.query().events).toEqual([event]);
    expect(destination.listSessions()[0]?.eventCount).toBe(1);
    source.close();
    destination.close();
  });

  it('rejects unknown versions and events that reference undeclared sessions', () => {
    expect(() =>
      parseSessionArchive({
        format: 'pulse-rn-session',
        version: 99,
        exportedAt: 1,
        sessions: [],
        events: [],
      }),
    ).toThrow();

    const source = database();
    seed(source);
    const archive = createSessionArchive(source, undefined, 2_000);
    expect(() =>
      parseSessionArchive({
        ...archive,
        sessions: archive.sessions.map((session) => ({
          ...session,
          data: { ...session.data, sessionId: 'different-session' },
        })),
      }),
    ).toThrow('Event references');
    source.close();
  });

  it('rejects modified checksummed entries before changing the destination database', () => {
    const source = database();
    seed(source);
    const archive = createSessionArchive(source, undefined, 2_000);
    const destination = database();
    const modified = {
      ...archive,
      events: archive.events.map((entry) => ({
        ...entry,
        data: { ...entry.data, type: 'tampered.event' },
      })),
    };

    expect(() => importSessionArchive(destination, modified)).toThrow('checksum');
    expect(destination.query().total).toBe(0);
    source.close();
    destination.close();
  });
});
