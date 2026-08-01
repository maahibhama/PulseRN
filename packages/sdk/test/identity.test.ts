import { describe, expect, it, vi } from 'vitest';
import { getOrCreatePulseRNDeviceId } from '../src/index.js';

describe('persistent device identity', () => {
  it('creates and then reuses a stored device ID', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };

    const first = await getOrCreatePulseRNDeviceId(storage);
    const second = await getOrCreatePulseRNDeviceId(storage);

    expect(first).toMatch(/^device_/);
    expect(second).toBe(first);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('replaces malformed stored IDs and rejects invalid keys', async () => {
    const storage = {
      getItem: vi.fn(() => 'invalid device id'),
      setItem: vi.fn(),
    };

    expect(await getOrCreatePulseRNDeviceId(storage)).toMatch(/^device_/);
    expect(storage.setItem).toHaveBeenCalledOnce();
    await expect(getOrCreatePulseRNDeviceId(storage, ' ')).rejects.toThrow('identity key');
  });
});
