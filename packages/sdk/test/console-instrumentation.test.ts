import { describe, expect, it, vi } from 'vitest';
import type { ConsoleLogLevel, ConsoleLogPayload } from '@pulse-rn/protocol';
import { installConsoleInterceptor } from '../src/console-instrumentation.js';
import { formatConsoleMessage, serializeConsoleValue } from '../src/serialization.js';

function createConsole() {
  return {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('console instrumentation', () => {
  it('preserves original behavior, captures payloads, and restores methods', () => {
    const target = createConsole();
    const originalLog = target.log;
    const events: { level: ConsoleLogLevel; payload: ConsoleLogPayload }[] = [];
    const restore = installConsoleInterceptor(target, (level, payload) =>
      events.push({ level, payload }),
    );

    target.log('checkout', { complete: true });
    expect(originalLog).toHaveBeenCalledWith('checkout', { complete: true });
    expect(events[0]).toMatchObject({
      level: 'log',
      payload: {
        arguments: ['checkout', { complete: true }],
        message: 'checkout {"complete":true}',
      },
    });

    restore();
    expect(target.log).toBe(originalLog);
  });

  it('serializes circular values and Error instances safely', () => {
    const circular: Record<string, unknown> = { token: 'visible before redaction' };
    circular.self = circular;
    expect(serializeConsoleValue(circular)).toEqual({
      token: 'visible before redaction',
      self: '[Circular]',
    });
    expect(serializeConsoleValue(new Error('boom'))).toMatchObject({
      name: 'Error',
      message: 'boom',
    });
    expect(
      formatConsoleMessage([
        { name: 'Error', message: 'boom', stack: 'Error: boom\n at example.ts:1:1' },
      ]),
    ).toBe('Error: boom');
  });

  it('reports the caller frame instead of the console wrapper frame', () => {
    const target = createConsole();
    const payloads: ConsoleLogPayload[] = [];
    const restore = installConsoleInterceptor(target, (_level, payload) => payloads.push(payload), {
      captureStackTrace: true,
    });

    target.warn('caller');
    expect(payloads[0]?.stack).not.toContain('console-instrumentation');
    expect(payloads[0]?.source?.file).not.toMatch(/^\s*at\s/);
    restore();
  });
});
