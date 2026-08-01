import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { EventDatabase } from './database.js';

const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-load-'));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('sustained event load', () => {
  it('keeps insertion, cursor queries, and retention bounded at 25,000 events', () => {
    const database = new EventDatabase(join(directory, 'load.sqlite'));
    const now = Date.now();
    const events = Array.from({ length: 25_000 }, (_, sequence) => ({
      id: `load-${sequence.toString().padStart(6, '0')}`,
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 'load-session',
      deviceId: 'load-device',
      appId: 'load-app',
      timestamp: now + sequence,
      sequence,
      category: 'console',
      type: 'console.log',
      payload: {
        level: 'log',
        arguments: [`event ${sequence}`],
        message: `event ${sequence}`,
      },
    })) satisfies DevToolEventEnvelope[];

    const insertStartedAt = performance.now();
    database.insertMany(events);
    const insertDurationMs = performance.now() - insertStartedAt;

    const queryDurations: number[] = [];
    let cursor;
    let loaded = 0;
    do {
      const queryStartedAt = performance.now();
      const page = database.query({ cursor, limit: 500, order: 'newest' });
      queryDurations.push(performance.now() - queryStartedAt);
      loaded += page.events.length;
      cursor = page.nextCursor;
    } while (cursor);

    const maintenance = database.maintain({ maxAgeDays: 30, maxEvents: 10_000 }, now + 25_000);
    const sortedQueryDurations = [...queryDurations].sort((left, right) => left - right);
    const queryP95Ms = sortedQueryDurations[Math.floor(sortedQueryDurations.length * 0.95)] ?? 0;

    expect(loaded).toBe(25_000);
    expect(maintenance).toMatchObject({
      removedOverflow: 15_000,
      retainedEvents: 10_000,
    });
    expect(insertDurationMs).toBeLessThan(15_000);
    expect(queryP95Ms).toBeLessThan(1_000);
    database.close();
  }, 30_000);
});
