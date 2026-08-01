import { describe, expect, it } from 'vitest';
import type { DevToolEventEnvelope, NetworkEventPayload } from '@pulse-rn/protocol';
import { createCurlCommand, createSanitizedHar } from './network-export.js';

const payload: NetworkEventPayload = {
  requestId: 'request-1',
  transport: 'fetch',
  method: 'POST',
  url: 'https://example.com/checkout?token=%5BREDACTED%5D',
  query: { token: '[REDACTED]' },
  requestHeaders: { authorization: 'secret', 'content-type': 'application/json' },
  requestBody: {
    value: { token: '[REDACTED]', amount: 42 },
    size: 40,
    truncated: false,
    contentType: 'application/json',
  },
  status: 200,
  responseHeaders: { 'set-cookie': 'secret', 'content-type': 'application/json' },
  startedAt: 1_000,
  endedAt: 1_020,
  duration: 20,
};

const event = {
  id: 'event-1',
  protocolVersion: '1.0.0',
  sessionId: 'session-1',
  deviceId: 'device-1',
  appId: 'app-1',
  timestamp: 1_020,
  sequence: 1,
  category: 'network',
  type: 'network.request',
  payload,
} satisfies DevToolEventEnvelope;

describe('network exports', () => {
  it('creates a shell-safe cURL command with reapplied header redaction', () => {
    const command = createCurlCommand(payload);
    expect(command).toContain('authorization: [REDACTED]');
    expect(command).not.toContain('authorization: secret');
    expect(command).toContain('--data-raw');
  });

  it('creates sanitized HAR 1.2 without secret headers', () => {
    const har = createSanitizedHar([event]);
    expect(har.log.entries).toHaveLength(1);
    expect(JSON.stringify(har)).not.toContain('authorization\\":\\"secret');
    expect(JSON.stringify(har)).not.toContain('set-cookie\\":\\"secret');
    expect(JSON.stringify(har)).toContain('[REDACTED]');
  });
});
