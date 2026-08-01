import type { JsonValue, PerformanceEventPayload, PerformanceMetric } from './protocol-types.js';

interface AnimationFrameRuntime {
  requestAnimationFrame?(callback: (timestamp: number) => void): number;
  cancelAnimationFrame?(handle: number): void;
}

interface MemoryRuntime {
  performance?: Performance & {
    memory?: { usedJSHeapSize?: number };
  };
}

export interface PerformanceMonitorOptions {
  sampleIntervalMs?: number;
  stallThresholdMs?: number;
  captureMemory?: boolean;
  now?: () => number;
  wallNow?: () => number;
  runtime?: AnimationFrameRuntime & MemoryRuntime;
}

export interface PerformanceMeasureOptions {
  metadata?: JsonValue;
}

const SDK_MODULE_STARTED_AT = globalThis.performance?.now?.() ?? Date.now();

export class PerformanceMonitor {
  private readonly marks = new Map<string, number>();
  private readonly screens = new Map<string, number>();
  private readonly now: () => number;
  private readonly wallNow: () => number;
  private readonly runtime: AnimationFrameRuntime & MemoryRuntime;
  private readonly sampleIntervalMs: number;
  private readonly stallThresholdMs: number;
  private readonly captureMemory: boolean;
  private timer?: ReturnType<typeof setInterval>;
  private animationFrame?: number;
  private frameCount = 0;
  private frameWindowStartedAt = 0;
  private started = false;
  private expectedSamples = 0;
  private lostSamples = 0;

  constructor(
    private readonly emit: (payload: PerformanceEventPayload) => void,
    options: PerformanceMonitorOptions = {},
  ) {
    this.now = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
    this.wallNow = options.wallNow ?? Date.now;
    this.runtime = options.runtime ?? globalThis;
    this.sampleIntervalMs = Math.max(250, options.sampleIntervalMs ?? 1_000);
    this.stallThresholdMs = Math.max(16, options.stallThresholdMs ?? 100);
    this.captureMemory = options.captureMemory ?? false;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.expectedSamples = 0;
    this.lostSamples = 0;
    this.reportCapabilities();
    let expected = this.now() + this.sampleIntervalMs;
    this.timer = setInterval(() => {
      const observed = this.now();
      const lag = Math.max(0, observed - expected);
      this.expectedSamples += 1;
      this.lostSamples += Math.max(0, Math.floor(lag / this.sampleIntervalMs));
      expected = observed + this.sampleIntervalMs;
      this.record('event_loop_lag', 'JavaScript event-loop lag', lag, 'ms', true);
      if (lag >= this.stallThresholdMs) {
        this.record('js_stall', 'JavaScript thread stall', lag, 'ms', true);
        this.record('long_task', 'Long JavaScript task', lag, 'ms', true);
      }
      if (this.captureMemory) this.captureMemorySample();
    }, this.sampleIntervalMs);
    this.startFrameSampling();
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.animationFrame !== undefined) this.runtime.cancelAnimationFrame?.(this.animationFrame);
    this.animationFrame = undefined;
  }

  mark(name: string): void {
    this.marks.set(name, this.now());
  }

  measure(
    name: string,
    startMark: string,
    endMark?: string,
    options: PerformanceMeasureOptions = {},
  ): number | undefined {
    const startedAt = this.marks.get(startMark);
    if (startedAt === undefined) return undefined;
    const endedAt = endMark ? this.marks.get(endMark) : this.now();
    if (endedAt === undefined) return undefined;
    const duration = Math.max(0, endedAt - startedAt);
    this.record(
      'custom_measure',
      name,
      duration,
      'ms',
      false,
      startedAt,
      endedAt,
      options.metadata,
    );
    return duration;
  }

  appStarted(name = 'Application start'): number {
    const endedAt = this.now();
    const duration = Math.max(0, endedAt - SDK_MODULE_STARTED_AT);
    this.record('app_start', name, duration, 'ms', true, SDK_MODULE_STARTED_AT, endedAt);
    return duration;
  }

  startScreen(name: string): void {
    this.screens.set(name, this.now());
  }

  screenMounted(name: string): number | undefined {
    return this.screenMeasure('screen_mount', name, 'mount');
  }

  screenInteractive(name: string): number | undefined {
    return this.screenMeasure('screen_interactive', name, 'interactive');
  }

  endScreen(name: string): number | undefined {
    const value = this.screenMeasure('screen_duration', name, 'duration');
    this.screens.delete(name);
    return value;
  }

  private screenMeasure(
    metric: Extract<PerformanceMetric, 'screen_mount' | 'screen_interactive' | 'screen_duration'>,
    name: string,
    suffix: string,
  ): number | undefined {
    const startedAt = this.screens.get(name);
    if (startedAt === undefined) return undefined;
    const endedAt = this.now();
    const duration = Math.max(0, endedAt - startedAt);
    this.record(metric, `${name} ${suffix}`, duration, 'ms', false, startedAt, endedAt, {
      screen: name,
    });
    return duration;
  }

  private startFrameSampling(): void {
    if (!this.runtime.requestAnimationFrame) return;
    this.frameCount = 0;
    this.frameWindowStartedAt = this.now();
    const onFrame = () => {
      if (!this.started) return;
      this.frameCount += 1;
      const now = this.now();
      const elapsed = now - this.frameWindowStartedAt;
      if (elapsed >= this.sampleIntervalMs) {
        const fps = (this.frameCount * 1_000) / elapsed;
        this.record('js_fps', 'JavaScript frame callback rate', fps, 'fps', true);
        this.frameCount = 0;
        this.frameWindowStartedAt = now;
      }
      this.animationFrame = this.runtime.requestAnimationFrame?.(onFrame);
    };
    this.animationFrame = this.runtime.requestAnimationFrame(onFrame);
  }

  private reportCapabilities(): void {
    this.recordCapability(
      'animation_frame',
      Boolean(this.runtime.requestAnimationFrame),
      'requestAnimationFrame is not exposed by this React Native runtime.',
    );
    if (this.captureMemory) {
      this.recordCapability(
        'js_heap',
        typeof this.runtime.performance?.memory?.usedJSHeapSize === 'number',
        'JavaScript heap metrics are not exposed by this runtime.',
      );
    }
    this.recordCapability('native_cpu', false, 'Native CPU profiling is outside SDK capability.');
    this.recordCapability('ui_thread', false, 'UI-thread profiling is outside SDK capability.');
    this.recordCapability(
      'native_memory',
      false,
      'Native-memory profiling is outside SDK capability.',
    );
  }

  private recordCapability(
    name: NonNullable<PerformanceEventPayload['capability']>['name'],
    available: boolean,
    unavailableReason: string,
  ): void {
    this.emit({
      metric: 'capability',
      name: name.replaceAll('_', ' '),
      value: 0,
      unit: 'count',
      approximate: false,
      provenance: 'runtime',
      capability: {
        name,
        status: available ? 'available' : 'unavailable',
        ...(!available ? { reason: unavailableReason } : {}),
      },
    });
  }

  private captureMemorySample(): void {
    const usedBytes = this.runtime.performance?.memory?.usedJSHeapSize;
    if (typeof usedBytes === 'number' && Number.isFinite(usedBytes) && usedBytes >= 0) {
      this.record('memory', 'JavaScript heap used', usedBytes, 'bytes', true);
    }
  }

  private record(
    metric: PerformanceMetric,
    name: string,
    value: number,
    unit: PerformanceEventPayload['unit'],
    approximate: boolean,
    startedAt?: number,
    endedAt?: number,
    metadata?: JsonValue,
  ): void {
    this.emit({
      metric,
      name,
      value,
      unit,
      approximate,
      provenance: approximate ? 'javascript' : 'runtime',
      ...(['event_loop_lag', 'js_stall', 'long_task', 'js_fps', 'memory'].includes(metric)
        ? {
            sampling: {
              intervalMs: this.sampleIntervalMs,
              expectedSamples: this.expectedSamples,
              lostSamples: this.lostSamples,
              captureRate:
                this.expectedSamples + this.lostSamples === 0
                  ? 1
                  : this.expectedSamples / (this.expectedSamples + this.lostSamples),
            },
          }
        : {}),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(endedAt === undefined ? {} : { endedAt }),
      ...(metadata === undefined ? {} : { metadata }),
    });
  }
}
