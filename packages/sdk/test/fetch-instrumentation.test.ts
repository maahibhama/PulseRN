import { describe, expect, it, vi } from 'vitest';
import type { NetworkEventPayload, NetworkLifecycleEventPayload } from '@pulse-rn/protocol';
import { installFetchInterceptor } from '../src/fetch-instrumentation.js';
import { captureTextBody, captureUnknownBody } from '../src/network-utils.js';

describe('fetch instrumentation', () => {
  it('captures, redacts, and preserves the original response body', async () => {
    const original = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ user: 'Ada', token: 'response-secret' }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-cookie': 'private' },
        }),
      ),
    );
    const target = { fetch: original as typeof fetch };
    const events: NetworkEventPayload[] = [];
    const restore = installFetchInterceptor(target, (payload) => events.push(payload), {
      redactedHeaders: ['authorization'],
      redactedQueryParameters: ['token'],
    });

    const response = await target.fetch('https://example.com/users?token=secret', {
      headers: { authorization: 'Bearer secret' },
    });
    expect(await response.json()).toEqual({ user: 'Ada', token: 'response-secret' });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({
      method: 'GET',
      status: 200,
      query: { token: '[REDACTED]' },
      requestHeaders: { authorization: '[REDACTED]' },
      responseHeaders: { 'set-cookie': '[REDACTED]' },
      responseBody: {
        value: { user: 'Ada', token: 'response-secret' },
      },
    });
    expect(events[0]?.url).not.toContain('token=secret');
    restore();
    expect(target.fetch).toBe(original);
  });

  it('records failures and rethrows them', async () => {
    const original = vi.fn(async () => Promise.reject(new TypeError('offline')));
    const target = { fetch: original as typeof fetch };
    const events: NetworkEventPayload[] = [];
    installFetchInterceptor(target, (payload) => events.push(payload));
    await expect(target.fetch('https://example.com')).rejects.toThrow('offline');
    expect(events[0]?.error).toEqual({ name: 'TypeError', message: 'offline' });
  });

  it('emits additive lifecycle events while preserving the completed request', async () => {
    const original = vi.fn(async () => new Response('ok', { status: 200 }));
    const target = { fetch: original as typeof fetch };
    const events: NetworkEventPayload[] = [];
    const lifecycle: { type: string; payload: NetworkLifecycleEventPayload }[] = [];
    installFetchInterceptor(
      target,
      (payload) => events.push(payload),
      {},
      (type, payload) => lifecycle.push({ type, payload }),
    );

    await target.fetch('https://example.com/health');
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(lifecycle.map(({ type }) => type)).toEqual([
      'network.request-start',
      'network.request-complete',
    ]);
    expect(lifecycle[0]?.payload.requestId).toBe(events[0]?.requestId);
    expect(events[0]?.timingAccuracy).toBe('measured');
  });

  it('enforces per-request and session body budgets after redaction', async () => {
    const original = vi.fn(
      async () => new Response('response body', { headers: { 'content-type': 'text/plain' } }),
    );
    const target = { fetch: original as typeof fetch };
    const events: NetworkEventPayload[] = [];
    let remaining = 4;
    installFetchInterceptor(target, (payload) => events.push(payload), {
      maxBodyBytes: 1_000,
      maxRequestBytes: 4,
      maxSessionBytes: 4,
      reserveCapture(bytes) {
        if (bytes > remaining) return false;
        remaining -= bytes;
        return true;
      },
    });

    await target.fetch('https://example.com', { method: 'POST', body: 'request body' });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]?.requestBody).toBeUndefined();
    expect(events[0]?.responseBody).toBeUndefined();
    expect(events[0]?.capture?.omittedBodies).toEqual(['request', 'response']);
  });

  it('enforces body limits by UTF-8 bytes and preserves structured values', () => {
    expect(captureTextBody('😀😀', 4)).toMatchObject({
      value: '😀',
      size: 8,
      truncated: true,
    });
    expect(captureUnknownBody({ token: 'secret' }, 1_000)).toMatchObject({
      value: { token: 'secret' },
      truncated: false,
    });
  });
});
