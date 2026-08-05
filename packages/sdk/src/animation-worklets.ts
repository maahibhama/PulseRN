import type { AnimationPhase, AnimationType, JsonValue, RuntimeKind } from './protocol-types.js';
import type { TrackEventInput } from './types.js';

export interface AnimationWorkletTrackTarget {
  track(event: TrackEventInput): void;
}

export interface SourceLocation {
  [key: string]: JsonValue | undefined;
  file: string;
  line: number;
  column?: number;
}

export interface FrameStatistics {
  [key: string]: JsonValue | undefined;
  expectedFrames: number;
  observedFrames: number;
  lateFrames: number;
  effectiveFps: number;
  longestFrameMs: number;
  timeToFirstFrameMs?: number;
  refreshRateHz?: number;
}

export interface AnimationDescriptor {
  id?: string;
  type: AnimationType;
  component?: string;
  viewTag?: string;
  properties?: string[];
  initialValue?: unknown;
  targetValue?: unknown;
  configuration?: Record<string, unknown>;
  source?: SourceLocation;
  runtimeId?: string;
  workletId?: string;
  triggerEventId?: string;
  correlationId?: string;
}

export interface WorkletRuntimeDescriptor {
  id: string;
  name?: string;
  kind: RuntimeKind;
  mode?: 'bundle' | 'legacy' | 'unknown';
  eventLoopEnabled?: boolean;
  animationQueuePollingRate?: number;
}

export interface WorkletDescriptor {
  id?: string;
  name?: string;
  source?: SourceLocation;
  origin: RuntimeKind;
  destination: RuntimeKind;
  runtimeId: string;
  correlationId?: string;
}

export interface AnimationWorkletOptions {
  enabled?: boolean;
  allowInProduction?: boolean;
  isDevelopment?: boolean;
  sampleIntervalMs?: number;
  maxSamplesPerAnimation?: number;
  slowWorkletThresholdMs?: number;
}

export interface AnimationWorkletCapabilities {
  reanimated: 'available' | 'unsupported' | 'missing';
  worklets: 'available' | 'unsupported' | 'missing';
  reasons: string[];
}

export function detectAnimationWorkletCapabilities(input: {
  reanimatedVersion?: string;
  workletsVersion?: string;
  newArchitecture?: boolean;
}): AnimationWorkletCapabilities {
  const reanimatedMajor = Number.parseInt(input.reanimatedVersion?.split('.')[0] ?? '', 10);
  const workletsMajor = Number.parseInt(input.workletsVersion?.split('.')[0] ?? '', 10);
  const reasons: string[] = [];
  const reanimated = !input.reanimatedVersion
    ? 'missing'
    : reanimatedMajor === 4 && input.newArchitecture !== false
      ? 'available'
      : 'unsupported';
  const worklets = !input.workletsVersion
    ? 'missing'
    : Number.isInteger(workletsMajor) && workletsMajor === 0
      ? 'available'
      : 'unsupported';
  if (reanimated === 'unsupported') {
    reasons.push(
      reanimatedMajor !== 4
        ? `Reanimated ${input.reanimatedVersion} is unsupported; version 4 is required.`
        : 'Reanimated 4 profiling requires React Native New Architecture.',
    );
  }
  if (worklets === 'unsupported') {
    reasons.push(`React Native Worklets ${input.workletsVersion} is unsupported.`);
  }
  return { reanimated, worklets, reasons };
}

const primitivePreview = (value: unknown): JsonValue => {
  if (value === undefined) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 4_096);
  return Object.prototype.toString.call(value).slice(0, 256);
};

const safeRecord = (
  record: Record<string, unknown> | undefined,
): Record<string, JsonValue> | undefined => {
  if (!record) return undefined;
  return Object.fromEntries(
    Object.entries(record)
      .slice(0, 100)
      .map(([key, value]) => [key.slice(0, 256), primitivePreview(value)]),
  );
};

let nextInstrumentationId = 0;
const createInstrumentationId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(++nextInstrumentationId).toString(36)}`;

export function calculateFrameStatistics(
  timestamps: readonly number[],
  refreshRateHz?: number,
): FrameStatistics {
  if (timestamps.length < 2) {
    return {
      expectedFrames: timestamps.length,
      observedFrames: timestamps.length,
      lateFrames: 0,
      effectiveFps: 0,
      longestFrameMs: 0,
      ...(refreshRateHz ? { refreshRateHz } : {}),
    };
  }
  const intervals = timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]!);
  const sorted = [...intervals].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const inferredRate = refreshRateHz ?? Math.max(1, Math.round(1_000 / median));
  const budget = 1_000 / inferredRate;
  const elapsed = timestamps.at(-1)! - timestamps[0]!;
  return {
    expectedFrames: Math.max(1, Math.round(elapsed / budget) + 1),
    observedFrames: timestamps.length,
    lateFrames: intervals.filter((interval) => interval > budget * 1.5).length,
    effectiveFps: elapsed > 0 ? ((timestamps.length - 1) * 1_000) / elapsed : 0,
    longestFrameMs: Math.max(...intervals),
    refreshRateHz: inferredRate,
  };
}

export function createAnimationWorkletProfiler(
  target: AnimationWorkletTrackTarget,
  options: AnimationWorkletOptions = {},
) {
  const globalDevelopment = (globalThis as { __DEV__?: boolean }).__DEV__;
  const enabled =
    options.enabled !== false &&
    (options.allowInProduction === true ||
      options.isDevelopment === true ||
      globalDevelopment === true);
  const sampleIntervalMs = Math.max(16, options.sampleIntervalMs ?? 100);
  const maxSamples = Math.max(1, options.maxSamplesPerAnimation ?? 120);
  const animations = new Map<
    string,
    {
      descriptor: AnimationDescriptor;
      samples: number;
      lastSampleAt: number;
      frames: number[];
      startedAt?: number;
    }
  >();

  const emit = (event: TrackEventInput): void => {
    if (enabled) target.track(event);
  };

  const animation = {
    create(descriptor: AnimationDescriptor): string {
      const id = descriptor.id ?? createInstrumentationId('animation');
      const timestamp = Date.now();
      animations.set(id, { descriptor, samples: 0, lastSampleAt: 0, frames: [] });
      emit({
        category: 'animation',
        type: 'animation.created',
        correlationId: descriptor.correlationId ?? id,
        payload: {
          schemaVersion: 1,
          animationId: id,
          animationType: descriptor.type,
          phase: 'created',
          timestamp,
          component: descriptor.component,
          viewTag: descriptor.viewTag,
          properties: descriptor.properties?.slice(0, 100),
          initialValue:
            descriptor.initialValue === undefined
              ? undefined
              : primitivePreview(descriptor.initialValue),
          targetValue:
            descriptor.targetValue === undefined
              ? undefined
              : primitivePreview(descriptor.targetValue),
          configuration: safeRecord(descriptor.configuration),
          source: descriptor.source,
          runtimeId: descriptor.runtimeId,
          workletId: descriptor.workletId,
          triggerEventId: descriptor.triggerEventId,
        },
      });
      return id;
    },
    phase(
      id: string,
      phase: Exclude<AnimationPhase, 'created' | 'running'>,
      details: {
        value?: unknown;
        error?: unknown;
        completionRuntime?: RuntimeKind;
        warning?: string;
      } = {},
    ): void {
      const state = animations.get(id);
      if (!state) return;
      const timestamp = Date.now();
      if (phase === 'started') state.startedAt = timestamp;
      const error =
        details.error instanceof Error
          ? { name: details.error.name, message: details.error.message, stack: details.error.stack }
          : details.error
            ? { name: 'Error', message: String(details.error) }
            : undefined;
      emit({
        category: 'animation',
        type: `animation.${phase}`,
        correlationId: state.descriptor.correlationId ?? id,
        payload: {
          schemaVersion: 1,
          animationId: id,
          animationType: state.descriptor.type,
          phase,
          timestamp,
          component: state.descriptor.component,
          viewTag: state.descriptor.viewTag,
          properties: state.descriptor.properties?.slice(0, 100),
          initialValue:
            state.descriptor.initialValue === undefined
              ? undefined
              : primitivePreview(state.descriptor.initialValue),
          targetValue:
            state.descriptor.targetValue === undefined
              ? undefined
              : primitivePreview(state.descriptor.targetValue),
          configuration: safeRecord(state.descriptor.configuration),
          source: state.descriptor.source,
          runtimeId: state.descriptor.runtimeId,
          workletId: state.descriptor.workletId,
          triggerEventId: state.descriptor.triggerEventId,
          sampledValue: details.value === undefined ? undefined : primitivePreview(details.value),
          durationMs: state.startedAt ? timestamp - state.startedAt : undefined,
          frame: calculateFrameStatistics(state.frames),
          completionRuntime: details.completionRuntime,
          warning: details.warning,
          error,
        },
      });
      if (phase === 'completed' || phase === 'cancelled' || phase === 'failed')
        animations.delete(id);
    },
    sample(id: string, value: unknown, frameTimestamp = Date.now(), progress?: number): void {
      const state = animations.get(id);
      if (!state) return;
      state.frames.push(frameTimestamp);
      if (state.samples >= maxSamples || frameTimestamp - state.lastSampleAt < sampleIntervalMs)
        return;
      state.samples += 1;
      state.lastSampleAt = frameTimestamp;
      emit({
        category: 'animation',
        type: 'animation.running',
        correlationId: state.descriptor.correlationId ?? id,
        payload: {
          schemaVersion: 1,
          animationId: id,
          animationType: state.descriptor.type,
          phase: 'running',
          timestamp: frameTimestamp,
          component: state.descriptor.component,
          viewTag: state.descriptor.viewTag,
          properties: state.descriptor.properties?.slice(0, 100),
          targetValue:
            state.descriptor.targetValue === undefined
              ? undefined
              : primitivePreview(state.descriptor.targetValue),
          source: state.descriptor.source,
          runtimeId: state.descriptor.runtimeId,
          workletId: state.descriptor.workletId,
          triggerEventId: state.descriptor.triggerEventId,
          sampledValue: primitivePreview(value),
          progress: progress === undefined ? undefined : Math.max(0, Math.min(1, progress)),
        },
      });
    },
  };

  const runtime = {
    capability(status: 'available' | 'unsupported' | 'missing', reason?: string): void {
      emit({
        category: 'worklet',
        type: 'worklet.capability',
        payload: {
          schemaVersion: 1,
          operation: 'capability',
          timestamp: Date.now(),
          runtimeId: 'worklets',
          runtimeKind: 'ui',
          status,
          reason,
        },
      });
    },
    created(descriptor: WorkletRuntimeDescriptor): void {
      emit({
        category: 'worklet',
        type: 'worklet.runtime-created',
        payload: {
          schemaVersion: 1,
          operation: 'runtime-created',
          timestamp: Date.now(),
          runtimeId: descriptor.id,
          runtimeName: descriptor.name,
          runtimeKind: descriptor.kind,
          mode: descriptor.mode,
          eventLoopEnabled: descriptor.eventLoopEnabled,
          animationQueuePollingRate: descriptor.animationQueuePollingRate,
        },
      });
    },
    disposed(descriptor: WorkletRuntimeDescriptor): void {
      emit({
        category: 'worklet',
        type: 'worklet.runtime-disposed',
        payload: {
          schemaVersion: 1,
          operation: 'runtime-disposed',
          timestamp: Date.now(),
          runtimeId: descriptor.id,
          runtimeName: descriptor.name,
          runtimeKind: descriptor.kind,
        },
      });
    },
  };

  function instrumentWorklet<Args extends unknown[], Result>(
    descriptor: WorkletDescriptor,
    schedule: (worklet: (...args: Args) => Result, ...args: Args) => unknown,
    worklet: (...args: Args) => Result,
  ): (...args: Args) => unknown {
    const workletId = descriptor.id ?? createInstrumentationId('worklet');
    return (...args: Args) => {
      const enqueuedAt = Date.now();
      emit({
        category: 'worklet',
        type: 'worklet.scheduled',
        correlationId: descriptor.correlationId ?? workletId,
        payload: {
          schemaVersion: 1,
          operation: 'scheduled',
          timestamp: enqueuedAt,
          runtimeId: descriptor.runtimeId,
          runtimeKind: descriptor.destination,
          workletId,
          workletName: descriptor.name,
          originRuntime: descriptor.origin,
          destinationRuntime: descriptor.destination,
          source: descriptor.source,
          enqueuedAt,
          argumentPreviews: args.slice(0, 20).map(primitivePreview),
          serializationBytes: JSON.stringify(args.map(primitivePreview)).length,
        },
      });
      return schedule(
        (...scheduledArgs: Args) => {
          const startedAt = Date.now();
          emit({
            category: 'worklet',
            type: 'worklet.started',
            correlationId: descriptor.correlationId ?? workletId,
            payload: {
              schemaVersion: 1,
              operation: 'started',
              timestamp: startedAt,
              runtimeId: descriptor.runtimeId,
              runtimeKind: descriptor.destination,
              workletId,
              workletName: descriptor.name,
              enqueuedAt,
              startedAt,
              queueWaitMs: startedAt - enqueuedAt,
            },
          });
          try {
            const result = worklet(...scheduledArgs);
            const endedAt = Date.now();
            emit({
              category: 'worklet',
              type: 'worklet.completed',
              correlationId: descriptor.correlationId ?? workletId,
              payload: {
                schemaVersion: 1,
                operation: 'completed',
                timestamp: endedAt,
                runtimeId: descriptor.runtimeId,
                runtimeKind: descriptor.destination,
                workletId,
                workletName: descriptor.name,
                enqueuedAt,
                startedAt,
                endedAt,
                queueWaitMs: startedAt - enqueuedAt,
                durationMs: endedAt - startedAt,
              },
            });
            return result;
          } catch (cause) {
            const endedAt = Date.now();
            const error =
              cause instanceof Error
                ? { name: cause.name, message: cause.message, stack: cause.stack }
                : { name: 'Error', message: String(cause) };
            emit({
              category: 'worklet',
              type: 'worklet.failed',
              correlationId: descriptor.correlationId ?? workletId,
              payload: {
                schemaVersion: 1,
                operation: 'failed',
                timestamp: endedAt,
                runtimeId: descriptor.runtimeId,
                runtimeKind: descriptor.destination,
                workletId,
                workletName: descriptor.name,
                enqueuedAt,
                startedAt,
                endedAt,
                queueWaitMs: startedAt - enqueuedAt,
                durationMs: endedAt - startedAt,
                error,
              },
            });
            throw cause;
          }
        },
        ...args,
      );
    };
  }

  return { enabled, animation, runtime, instrumentWorklet };
}
