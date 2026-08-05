import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppearanceStore, BUILTIN_THEMES } from './appearance.js';

describe('AppearanceStore', () => {
  const create = (legacy?: 'system' | 'dark' | 'light') => {
    const directory = mkdtempSync(join(tmpdir(), 'pulsern-appearance-'));
    const file = join(directory, 'appearance.json');
    return { store: new AppearanceStore(file, legacy), file };
  };

  it('ships immutable presets and migrates the legacy theme', () => {
    const { store } = create('light');
    expect(store.get()).toMatchObject({ mode: 'fixed', fixedThemeId: 'pulse-light' });
    expect(store.get().themes).toHaveLength(BUILTIN_THEMES.length);
    expect(() => store.deleteTheme('pulse-light')).toThrow('Built-in themes');
  });

  it('duplicates, edits, selects, persists, and deletes a custom theme', () => {
    const { store, file } = create();
    let state = store.duplicateTheme('midnight');
    const custom = state.themes.at(-1)!;
    state = store.saveTheme({ ...custom, name: 'Ocean Debugger', builtin: undefined });
    state = store.updateSelection({ mode: 'fixed', fixedThemeId: custom.id });
    expect(state.fixedThemeId).toBe(custom.id);
    expect(JSON.parse(readFileSync(file, 'utf8')).fixedThemeId).toBe(custom.id);
    state = store.deleteTheme(custom.id);
    expect(state.fixedThemeId).toBe('pulse-dark');
  });

  it('resolves independent light and dark themes in system mode', () => {
    const { store } = create();
    store.updateSelection({ mode: 'system', lightThemeId: 'pulse-light', darkThemeId: 'nord' });
    expect(store.resolved(false).id).toBe('pulse-light');
    expect(store.resolved(true).id).toBe('nord');
  });

  it('prevents deleting fonts referenced by a theme', () => {
    const { store } = create();
    store.addFont({
      id: 'system-avenir',
      family: 'Avenir',
      style: 'normal',
      weight: 400,
      source: 'system',
    });
    const custom = store.duplicateTheme('pulse-dark').themes.at(-1)!;
    store.saveTheme({ ...custom, uiFontId: 'system-avenir', builtin: undefined });
    expect(() => store.removeFont('system-avenir')).toThrow('used by a theme');
  });
});
