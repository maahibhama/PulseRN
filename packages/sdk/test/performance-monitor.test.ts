import { describe, expect, it, vi } from 'vitest';
import { PerformanceMonitor } from '../src/performance-monitor.js';

describe('PerformanceMonitor', () => {
  it('records custom marks and measures', () => {
    const emit = vi.fn();
    let now = 10;
    const monitor = new PerformanceMonitor(emit, { now: () => now });
    monitor.mark('start');
    now = 35;
    monitor.mark('end');
    expect(monitor.measure('checkout', 'start', 'end')).toBe(25);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: 'custom_measure',
        name: 'checkout',
        value: 25,
        approximate: false,
      }),
    );
  });

  it('records screen milestones from the same start point', () => {
    const emit = vi.fn();
    let now = 100;
    const monitor = new PerformanceMonitor(emit, { now: () => now });
    monitor.startScreen('Checkout');
    now = 112;
    expect(monitor.screenMounted('Checkout')).toBe(12);
    now = 145;
    expect(monitor.screenInteractive('Checkout')).toBe(45);
    now = 180;
    expect(monitor.endScreen('Checkout')).toBe(80);
    expect(emit).toHaveBeenCalledTimes(3);
  });

  it('returns undefined for missing marks and screen starts', () => {
    const monitor = new PerformanceMonitor(vi.fn());
    expect(monitor.measure('missing', 'unknown')).toBeUndefined();
    expect(monitor.screenMounted('Unknown')).toBeUndefined();
  });

  it('reports sampling quality and unavailable runtime/native capabilities explicitly', () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    let now = 0;
    const monitor = new PerformanceMonitor(emit, {
      now: () => now,
      sampleIntervalMs: 1_000,
      captureMemory: true,
      runtime: {},
    });
    monitor.start();
    const capabilities = emit.mock.calls.map(([payload]) => payload.capability).filter(Boolean);
    expect(capabilities).toEqual([
      {
        name: 'animation_frame',
        status: 'unavailable',
        reason: 'requestAnimationFrame is not exposed by this React Native runtime.',
      },
      {
        name: 'js_heap',
        status: 'unavailable',
        reason: 'JavaScript heap metrics are not exposed by this runtime.',
      },
      {
        name: 'native_cpu',
        status: 'unavailable',
        reason: 'Native CPU profiling is outside SDK capability.',
      },
      {
        name: 'ui_thread',
        status: 'unavailable',
        reason: 'UI-thread profiling is outside SDK capability.',
      },
      {
        name: 'native_memory',
        status: 'unavailable',
        reason: 'Native-memory profiling is outside SDK capability.',
      },
    ]);
    now = 3_100;
    vi.advanceTimersByTime(1_000);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: 'event_loop_lag',
        value: 2_100,
        provenance: 'javascript',
        sampling: {
          intervalMs: 1_000,
          expectedSamples: 1,
          lostSamples: 2,
          captureRate: 1 / 3,
        },
      }),
    );
    monitor.stop();
    vi.useRealTimers();
  });
});
