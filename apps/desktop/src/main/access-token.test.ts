import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AccessTokenStore } from './access-token.js';

describe('AccessTokenStore', () => {
  it('creates, persists, and rotates a 256-bit access token', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-token-'));
    const path = join(directory, 'access-token');
    const store = new AccessTokenStore(path);
    const first = store.get();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new AccessTokenStore(path).get()).toBe(first);
    expect(store.rotate()).not.toBe(first);
    expect(readFileSync(path, 'utf8').trim()).toBe(store.get());
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('replaces malformed stored tokens', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-token-'));
    const path = join(directory, 'access-token');
    writeFileSync(path, 'weak-token\n');

    expect(new AccessTokenStore(path).get()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
