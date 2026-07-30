import { describe, expect, it } from 'vitest';
import type { NetworkEventPayload } from '@pulse-rn/protocol';
import { installXhrInterceptor } from '../src/xhr-instrumentation.js';

class FakeXhr {
  status = 200;
  statusText = 'OK';
  responseType = '';
  response: unknown;
  responseText = '{"ok":true}';
  private listeners = new Map<string, (() => void)[]>();
  private requestHeaders: Record<string, string> = {};

  open() {}
  send() {
    for (const listener of this.listeners.get('loadend') ?? []) listener();
  }
  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name] = value;
  }
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }
  getAllResponseHeaders() {
    return 'content-type: application/json\r\nset-cookie: private';
  }
}

describe('XMLHttpRequest instrumentation', () => {
  it('captures request and response details without changing XHR behavior', () => {
    const events: NetworkEventPayload[] = [];
    const restore = installXhrInterceptor(FakeXhr, (payload) => events.push(payload), {
      redactedQueryParameters: ['otp'],
    });
    const request = new FakeXhr();
    request.open('POST', 'https://example.com/login?otp=1234');
    request.setRequestHeader('content-type', 'application/json');
    request.send('{"name":"Ada"}');

    expect(events[0]).toMatchObject({
      transport: 'xhr',
      method: 'POST',
      status: 200,
      query: { otp: '[REDACTED]' },
      requestBody: { value: { name: 'Ada' } },
      responseBody: { value: { ok: true } },
      responseHeaders: { 'set-cookie': '[REDACTED]' },
    });
    restore();
  });
});
