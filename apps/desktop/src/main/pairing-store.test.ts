import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PairingStore } from './pairing-store.js';

function credentials(pairingCode?: string, reconnectToken?: string) {
  return {
    appId: 'app-1',
    deviceId: 'device-1',
    appName: 'Example',
    deviceName: 'iPhone',
    pairingCode,
    reconnectToken,
  };
}

describe('PairingStore', () => {
  it('consumes one-time codes and persists only hashed reconnect tokens', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-pairing-'));
    const path = join(directory, 'trusted-devices.json');
    const store = new PairingStore(path);
    const pairing = store.begin(1_000);
    const accepted = store.authenticate(credentials(pairing.code), 2_000);

    expect(accepted).toMatchObject({ accepted: true, trustStatus: 'paired' });
    if (!accepted.accepted || !accepted.reconnectToken) throw new Error('Token was not issued.');
    expect(store.authenticate(credentials(pairing.code), 2_001)).toMatchObject({
      accepted: false,
    });
    expect(
      new PairingStore(path).authenticate(credentials(undefined, accepted.reconnectToken), 3_000),
    ).toMatchObject({
      accepted: true,
      trustStatus: 'trusted',
    });
    const stored = readFileSync(path, 'utf8');
    expect(stored).not.toContain(pairing.code);
    expect(stored).not.toContain(accepted.reconnectToken);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('expires challenges, limits retries, and rejects revoked tokens', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-pairing-'));
    const path = join(directory, 'trusted-devices.json');
    const store = new PairingStore(path);
    const expired = store.begin(1_000);
    expect(store.authenticate(credentials(expired.code), 1_000 + 5 * 60_000)).toMatchObject({
      accepted: false,
    });

    store.begin(10_000);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(store.authenticate(credentials('AAAA-AAAA'), 10_001 + attempt)).toMatchObject({
        accepted: false,
      });
    }
    expect(store.pairingCode(10_100)).toBeUndefined();

    const replacement = store.begin(20_000);
    const accepted = store.authenticate(credentials(replacement.code), 20_001);
    if (!accepted.accepted || !accepted.reconnectToken) throw new Error('Token was not issued.');
    expect(store.revoke('app-1', 'device-1', 30_000)).toBe(true);
    expect(
      store.authenticate(credentials(undefined, accepted.reconnectToken), 30_001),
    ).toMatchObject({
      accepted: false,
    });
    expect(store.list()[0]).toMatchObject({ status: 'revoked', revokedAt: 30_000 });
  });
});
