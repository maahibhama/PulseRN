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

    expect(store.get()).toMatchObject({ theme: 'system', density: 'comfortable' });
    store.update({ theme: 'light', density: 'compact', launchAtLogin: true });

    expect(new SettingsStore(filePath).get()).toMatchObject({
      theme: 'light',
      density: 'compact',
      launchAtLogin: true,
    });
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).not.toHaveProperty('unknown');
  });

  it('rejects unknown or invalid preference values', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-settings-'));
    const store = new SettingsStore(join(directory, 'settings.json'));

    expect(() => store.update({ theme: 'neon' })).toThrow();
    expect(() => store.update({ unknown: true })).toThrow();
  });
});
