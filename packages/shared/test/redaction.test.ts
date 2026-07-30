import { describe, expect, it } from 'vitest';
import { redact } from '../src/index.js';

describe('redact', () => {
  it('redacts nested sensitive fields and circular values', () => {
    const value: Record<string, unknown> = { nested: { accessToken: 'secret' } };
    value.self = value;
    expect(redact(value)).toEqual({
      nested: { accessToken: '[REDACTED]' },
      self: '[Circular]',
    });
  });
});
