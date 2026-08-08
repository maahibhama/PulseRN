import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsClient } from './analytics.js';

describe('AnalyticsClient', () => {
  it('sends nothing before explicit consent', async () => {
    const fetch = vi.fn();
    const client = new AnalyticsClient({
      statePath: join(await mkdtemp(join(tmpdir(), 'pulsern-analytics-')), 'state.json'),
      version: '1.0.6',
      distribution: 'desktop',
      enabled: () => false,
      apiKey: 'test',
      fetch,
    });
    expect(await client.capture('install_started')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows only fixed events and safe properties', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pulsern-analytics-'));
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const client = new AnalyticsClient({
      statePath: join(directory, 'state.json'),
      version: '1.0.6',
      distribution: 'cli',
      enabled: () => true,
      apiKey: 'test',
      fetch,
    });
    await expect(client.capture('first_app_connected', { reason: 'success' })).resolves.toBe(true);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body)).properties).not.toHaveProperty(
      'appId',
    );
    await expect(
      client.capture('first_event_persisted', { url: 'https://private.test' } as never),
    ).rejects.toThrow();
    expect(
      JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).installationId,
    ).toBeTruthy();
    await client.reset();
    await expect(readFile(join(directory, 'state.json'))).rejects.toThrow();
  });
});
