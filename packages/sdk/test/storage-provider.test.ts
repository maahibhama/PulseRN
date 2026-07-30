import { describe, expect, it, vi } from 'vitest';
import { createAsyncStorageProvider, createMMKVStorageProvider } from '../src/storage-provider.js';

describe('createAsyncStorageProvider', () => {
  it('adapts AsyncStorage without adding a runtime dependency', async () => {
    const storage = {
      getAllKeys: vi.fn(async () => ['theme']),
      getItem: vi.fn(async () => 'dark'),
      setItem: vi.fn(async () => undefined),
      removeItem: vi.fn(async () => undefined),
    };
    const provider = createAsyncStorageProvider(storage);
    expect(provider).toMatchObject({ id: 'async-storage', name: 'AsyncStorage' });
    await expect(provider.getAllKeys()).resolves.toEqual(['theme']);
    await expect(provider.getItem('theme')).resolves.toBe('dark');
    await provider.setItem('theme', 'light');
    await provider.removeItem('theme');
    expect(storage.setItem).toHaveBeenCalledWith('theme', 'light');
    expect(storage.removeItem).toHaveBeenCalledWith('theme');
  });
});

describe('createMMKVStorageProvider', () => {
  it('reads and preserves string, number, and boolean value types', async () => {
    const values = new Map<string, string | number | boolean>([
      ['name', 'PulseRN'],
      ['count', 2],
      ['enabled', true],
    ]);
    const storage = {
      getAllKeys: () => [...values.keys()],
      getString: (key: string) => {
        const value = values.get(key);
        return typeof value === 'string' ? value : undefined;
      },
      getNumber: (key: string) => {
        const value = values.get(key);
        return typeof value === 'number' ? value : undefined;
      },
      getBoolean: (key: string) => {
        const value = values.get(key);
        return typeof value === 'boolean' ? value : undefined;
      },
      set: vi.fn((key: string, value: string | number | boolean | ArrayBuffer) => {
        if (!(value instanceof ArrayBuffer)) values.set(key, value);
      }),
      remove: vi.fn((key: string) => values.delete(key)),
    };
    const provider = createMMKVStorageProvider(storage);
    await expect(provider.getItem('name')).resolves.toBe('PulseRN');
    await expect(provider.getItem('count')).resolves.toBe('2');
    await expect(provider.getItem('enabled')).resolves.toBe('true');
    await provider.setItem('count', '7.5');
    await provider.setItem('enabled', 'false');
    expect(storage.set).toHaveBeenCalledWith('count', 7.5);
    expect(storage.set).toHaveBeenCalledWith('enabled', false);
  });

  it('keeps ArrayBuffer values read-only', async () => {
    const provider = createMMKVStorageProvider({
      getAllKeys: () => ['blob'],
      getString: () => undefined,
      getBuffer: () => new ArrayBuffer(12),
      set: vi.fn(),
      remove: vi.fn(),
    });
    await expect(provider.getItem('blob')).resolves.toContain('12 bytes');
    await expect(provider.setItem('blob', 'replacement')).rejects.toThrow('does not edit binary');
  });

  it('supports the MMKV v3 delete method', async () => {
    const remove = vi.fn();
    const provider = createMMKVStorageProvider({
      getAllKeys: () => ['legacy'],
      getString: () => 'value',
      set: vi.fn(),
      delete: remove,
    });
    await provider.removeItem('legacy');
    expect(remove).toHaveBeenCalledWith('legacy');
  });
});
