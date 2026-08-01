import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsStore } from './settings.js';

describe('SettingsStore', () => {
  it('persists validated settings and restores them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-settings-'));
    const filePath = join(directory, 'settings.json');
    const store = new SettingsStore(filePath);

    expect(store.get()).toMatchObject({
      theme: 'system',
      density: 'comfortable',
      metroPort: 8081,
      devToolPort: 9090,
      allowLanConnections: false,
      tlsEnabled: false,
      eventRetentionDays: 30,
      maxStoredEvents: 100_000,
      consoleCaptureLimit: 6_000,
      updateChannel: 'stable',
      motion: 'system',
      checkForUpdatesAutomatically: true,
    });
    store.update({
      theme: 'light',
      density: 'compact',
      launchAtLogin: true,
      metroPort: 8090,
      devToolPort: 9191,
      allowLanConnections: true,
      tlsEnabled: true,
      eventRetentionDays: 7,
      maxStoredEvents: 50_000,
      consoleCaptureLimit: 2_000,
      redactionFields: ['token', 'apiKey'],
      updateChannel: 'beta',
      motion: 'reduced',
      checkForUpdatesAutomatically: false,
    });

    expect(new SettingsStore(filePath).get()).toMatchObject({
      theme: 'light',
      density: 'compact',
      launchAtLogin: true,
      metroPort: 8090,
      devToolPort: 9191,
      allowLanConnections: true,
      tlsEnabled: true,
      eventRetentionDays: 7,
      maxStoredEvents: 50_000,
      consoleCaptureLimit: 2_000,
      redactionFields: ['token', 'apiKey'],
      updateChannel: 'beta',
      motion: 'reduced',
      checkForUpdatesAutomatically: false,
    });
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).not.toHaveProperty('unknown');
  });

  it('rejects unknown or invalid preference values', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-settings-'));
    const store = new SettingsStore(join(directory, 'settings.json'));

    expect(() => store.update({ theme: 'neon' })).toThrow();
    expect(() => store.update({ unknown: true })).toThrow();
    expect(() => store.update({ metroPort: 0 })).toThrow();
    expect(() => store.update({ metroPort: 65_536 })).toThrow();
    expect(() => store.update({ devToolPort: 1_023 })).toThrow();
    expect(() => store.update({ eventRetentionDays: 0 })).toThrow();
    expect(() => store.update({ maxStoredEvents: 999 })).toThrow();
    expect(() => store.update({ redactionFields: [''] })).toThrow();
    expect(() => store.update({ networkBodyCaptureBytes: 17 * 1_024 * 1_024 })).toThrow();
    expect(() => store.update({ pairingRetryLimit: 21 })).toThrow();
    expect(() => store.update({ updateChannel: 'nightly' })).toThrow();
  });
});
