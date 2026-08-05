import { describe, expect, it, vi } from 'vitest';
import {
  calculateFrameStatistics,
  createAnimationWorkletProfiler,
  detectAnimationWorkletCapabilities,
} from '../src/animation-worklets.js';
import type { TrackEventInput } from '../src/types.js';

describe('animation and worklet profiler', () => {
  it('infers 60 Hz and 120 Hz budgets from timestamps', () => {
    const sixty = calculateFrameStatistics([0, 16.67, 33.34, 50.01]);
    const oneTwenty = calculateFrameStatistics([0, 8.33, 16.66, 24.99]);
    expect(sixty.refreshRateHz).toBe(60);
    expect(oneTwenty.refreshRateHz).toBe(120);
    expect(sixty.lateFrames).toBe(0);
    expect(calculateFrameStatistics([0, 16, 55], 60).lateFrames).toBe(1);
  });

  it('samples animations without emitting every frame', () => {
    const events: TrackEventInput[] = [];
    const profiler = createAnimationWorkletProfiler(
      { track: (event) => events.push(event) },
      { isDevelopment: true, sampleIntervalMs: 100, maxSamplesPerAnimation: 2 },
    );
    const id = profiler.animation.create({
      type: 'timing',
      component: 'CheckoutButton',
      properties: ['opacity'],
      runtimeId: 'ui-runtime',
      targetValue: 1,
    });
    profiler.animation.phase(id, 'started');
    profiler.animation.sample(id, 0.1, 100);
    profiler.animation.sample(id, 0.2, 110);
    profiler.animation.sample(id, 0.8, 250);
    profiler.animation.sample(id, 0.9, 400);
    profiler.animation.phase(id, 'completed', { value: 1 });
    expect(events.filter((event) => event.type === 'animation.running')).toHaveLength(2);
    expect(events.at(-1)?.type).toBe('animation.completed');
    expect(events.at(-1)?.payload).toMatchObject({
      component: 'CheckoutButton',
      properties: ['opacity'],
      runtimeId: 'ui-runtime',
      targetValue: 1,
    });
  });

  it('preserves worklet errors and correlation while rethrowing', () => {
    const events: TrackEventInput[] = [];
    const profiler = createAnimationWorkletProfiler(
      { track: (event) => events.push(event) },
      { isDevelopment: true },
    );
    const schedule = (worklet: () => void) => worklet();
    const wrapped = profiler.instrumentWorklet(
      { runtimeId: 'ui', origin: 'react-native', destination: 'ui', correlationId: 'gesture-1' },
      schedule,
      () => {
        throw new Error('worklet exploded');
      },
    );
    expect(wrapped).toThrow('worklet exploded');
    expect(events.map((event) => event.type)).toEqual([
      'worklet.scheduled',
      'worklet.started',
      'worklet.failed',
    ]);
    expect(events.every((event) => event.correlationId === 'gesture-1')).toBe(true);
  });

  it('stays inert outside development by default', () => {
    const track = vi.fn();
    const profiler = createAnimationWorkletProfiler({ track }, { isDevelopment: false });
    profiler.runtime.capability('missing', 'not installed');
    expect(track).not.toHaveBeenCalled();
  });

  it('gates Reanimated 4 on New Architecture and tolerates missing libraries', () => {
    expect(
      detectAnimationWorkletCapabilities({
        reanimatedVersion: '4.2.0',
        workletsVersion: '0.10.1',
        newArchitecture: true,
      }),
    ).toMatchObject({ reanimated: 'available', worklets: 'available' });
    expect(
      detectAnimationWorkletCapabilities({
        reanimatedVersion: '3.19.0',
        newArchitecture: false,
      }),
    ).toMatchObject({ reanimated: 'unsupported', worklets: 'missing' });
  });
});
