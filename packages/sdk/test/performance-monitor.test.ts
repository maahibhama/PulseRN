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
});
