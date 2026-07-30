import { describe, expect, it, vi } from 'vitest';
import { installErrorInterceptor, toCapturedError } from '../src/error-instrumentation.js';

describe('error instrumentation', () => {
  it('normalizes Error objects and non-Error rejection values', () => {
    expect(toCapturedError(new TypeError('broken'), 'manual')).toMatchObject({
      source: 'manual',
      name: 'TypeError',
      message: 'broken',
      fatal: false,
    });
    expect(toCapturedError({ reason: 'offline' }, 'unhandled_rejection')).toMatchObject({
      name: 'Error',
      message: '{"reason":"offline"}',
    });
  });

  it('captures and restores React Native global errors', () => {
    const original = vi.fn();
    let handler: (error: unknown, fatal?: boolean) => void = original;
    const target = {
      ErrorUtils: {
        getGlobalHandler: () => handler,
        setGlobalHandler: (next: typeof handler) => {
          handler = next;
        },
      },
    } as Parameters<typeof installErrorInterceptor>[0];
    const emit = vi.fn();
    const restore = installErrorInterceptor(target, emit);

    handler(new Error('global failure'), true);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'uncaught', message: 'global failure', fatal: true }),
    );
    expect(original).toHaveBeenCalledOnce();

    restore();
    expect(handler).toBe(original);
  });
});
