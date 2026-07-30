import type { JsonValue, ReduxEventPayload, ReduxStateDiff } from './protocol-types.js';
import { redact } from '@pulse-rn/shared';

export interface ReduxTrackTarget {
  track(event: { category: 'redux'; type: string; payload: ReduxEventPayload }): void;
}

export interface DevToolMiddlewareOptions {
  client?: ReduxTrackTarget;
  storeId?: string;
  captureState?: boolean;
  captureStateDiff?: boolean;
  maxStateDepth?: number;
  redactedFields?: readonly string[];
  actionFilter?: (action: unknown) => boolean;
}

interface ReduxStoreLike {
  getState(): unknown;
}

interface ReduxActionLike {
  type?: unknown;
  [key: string]: unknown;
}

type Next = (action: unknown) => unknown;

function toJson(
  value: unknown,
  maxDepth: number,
  depth = 0,
  seen = new WeakSet<object>(),
): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'undefined') return '[Undefined]';
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();
  if (depth >= maxDepth) return '[Max depth]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }
  if (Array.isArray(value)) return value.map((item) => toJson(item, maxDepth, depth + 1, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, toJson(item, maxDepth, depth + 1, seen)]),
  );
}

function same(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function diffStates(
  previous: JsonValue,
  next: JsonValue,
  path = '$',
  output: ReduxStateDiff[] = [],
): ReduxStateDiff[] {
  if (same(previous, next)) return output;
  const previousObject =
    previous !== null && typeof previous === 'object' && !Array.isArray(previous);
  const nextObject = next !== null && typeof next === 'object' && !Array.isArray(next);
  if (previousObject && nextObject) {
    const before = previous as Record<string, JsonValue>;
    const after = next as Record<string, JsonValue>;
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const childPath = `${path}.${key}`;
      if (!(key in before)) output.push({ path: childPath, kind: 'added', after: after[key]! });
      else if (!(key in after))
        output.push({ path: childPath, kind: 'removed', before: before[key]! });
      else diffStates(before[key]!, after[key]!, childPath, output);
    }
    return output;
  }
  output.push({ path, kind: 'changed', before: previous, after: next });
  return output;
}

export function createDevToolMiddleware(options: DevToolMiddlewareOptions = {}) {
  const storeId = options.storeId ?? 'default';
  const captureState = options.captureState ?? true;
  const captureStateDiff = options.captureStateDiff ?? true;
  const maxStateDepth = options.maxStateDepth ?? 10;

  return (store: ReduxStoreLike) =>
    (next: Next) =>
    (action: unknown): unknown => {
      if (options.actionFilter && !options.actionFilter(action)) return next(action);
      const previousRaw = store.getState();
      const startedAt = globalThis.performance?.now?.() ?? Date.now();
      const result = next(action);
      const reducerDuration = Math.max(
        0,
        (globalThis.performance?.now?.() ?? Date.now()) - startedAt,
      );
      const nextRaw = store.getState();
      const actionObject =
        action !== null && typeof action === 'object'
          ? (action as ReduxActionLike)
          : { type: String(action) };
      const actionType = typeof actionObject.type === 'string' ? actionObject.type : 'unknown';
      const sanitize = (value: unknown) =>
        redact(toJson(value, maxStateDepth), { fields: options.redactedFields }) as JsonValue;
      const previousState = sanitize(previousRaw);
      const nextState = sanitize(nextRaw);
      const payload: ReduxEventPayload = {
        storeId,
        actionType,
        action: sanitize(action),
        reducerDuration,
        ...(captureState ? { previousState, nextState } : {}),
        ...(captureStateDiff ? { stateDiff: diffStates(previousState, nextState) } : {}),
      };
      options.client?.track({ category: 'redux', type: 'redux.action', payload });
      return result;
    };
}
