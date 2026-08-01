import type { JsonValue, ReduxEventPayload, ReduxStateDiff } from './protocol-types.js';
import { redact } from '@pulse-rn/shared';

export interface ReduxTrackTarget {
  track(event: {
    category: 'redux';
    type: string;
    payload: ReduxEventPayload;
    correlationId?: string;
    parentId?: string;
  }): void;
}

export interface ReduxCorrelationContext {
  correlationId?: string;
  parentId?: string;
  route?: string;
  requestId?: string;
  errorId?: string;
  performanceEventId?: string;
}

export interface DevToolMiddlewareOptions {
  client?: ReduxTrackTarget;
  storeId?: string;
  captureState?: boolean;
  captureStateDiff?: boolean;
  maxStateDepth?: number;
  maxStateProperties?: number;
  maxStateBytes?: number;
  stateSizeWarningBytes?: number;
  redactedFields?: readonly string[];
  actionFilter?: (action: unknown) => boolean;
  actionAllowList?: readonly string[];
  actionDenyList?: readonly string[];
  actionCategories?: Readonly<Record<string, readonly string[]>>;
  enabledCategories?: readonly string[];
  getCorrelationContext?: (action: unknown) => ReduxCorrelationContext | undefined;
}

interface ReduxStoreLike {
  getState(): unknown;
}

interface ReduxActionLike {
  type?: unknown;
  [key: string]: unknown;
}

type Next = (action: unknown) => unknown;

interface SerializationBudget {
  remainingProperties: number;
  truncated: boolean;
}

function toJson(
  value: unknown,
  maxDepth: number,
  budget: SerializationBudget,
  depth = 0,
  seen = new WeakSet<object>(),
): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'undefined') return '[Undefined]';
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();
  if (depth >= maxDepth) {
    budget.truncated = true;
    return '[Max depth]';
  }
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
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (const item of value) {
      if (budget.remainingProperties <= 0) {
        budget.truncated = true;
        result.push('[Property limit]');
        break;
      }
      budget.remainingProperties -= 1;
      result.push(toJson(item, maxDepth, budget, depth + 1, seen));
    }
    return result;
  }
  const result: Record<string, JsonValue> = {};
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (budget.remainingProperties <= 0) {
      budget.truncated = true;
      result['[Truncated]'] = '[Property limit]';
      break;
    }
    budget.remainingProperties -= 1;
    result[key] = toJson(
      (value as Record<string, unknown>)[key],
      maxDepth,
      budget,
      depth + 1,
      seen,
    );
  }
  return result;
}

function same(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function diffStates(
  previous: JsonValue,
  next: JsonValue,
  path = '$',
  output: ReduxStateDiff[] = [],
  limit = 10_000,
): ReduxStateDiff[] {
  if (output.length >= limit) return output;
  if (same(previous, next)) return output;
  const previousObject =
    previous !== null && typeof previous === 'object' && !Array.isArray(previous);
  const nextObject = next !== null && typeof next === 'object' && !Array.isArray(next);
  if (previousObject && nextObject) {
    const before = previous as Record<string, JsonValue>;
    const after = next as Record<string, JsonValue>;
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (output.length >= limit) break;
      const childPath = `${path}.${key}`;
      if (!(key in before)) output.push({ path: childPath, kind: 'added', after: after[key]! });
      else if (!(key in after))
        output.push({ path: childPath, kind: 'removed', before: before[key]! });
      else diffStates(before[key]!, after[key]!, childPath, output, limit);
    }
    return output;
  }
  output.push({ path, kind: 'changed', before: previous, after: next });
  return output;
}

function matchesAction(actionType: string, patterns: readonly string[] | undefined): boolean {
  return (
    patterns?.some((pattern) =>
      pattern.endsWith('*') ? actionType.startsWith(pattern.slice(0, -1)) : actionType === pattern,
    ) ?? false
  );
}

function jsonBytes(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function createDevToolMiddleware(options: DevToolMiddlewareOptions = {}) {
  const storeId = options.storeId ?? 'default';
  const captureState = options.captureState ?? true;
  const captureStateDiff = options.captureStateDiff ?? true;
  const maxStateDepth = options.maxStateDepth ?? 10;
  const maxStateProperties = Math.max(1, options.maxStateProperties ?? 10_000);
  const maxStateBytes = Math.max(1_024, options.maxStateBytes ?? 512 * 1_024);
  const warningThreshold = Math.max(
    1_024,
    options.stateSizeWarningBytes ?? Math.min(maxStateBytes, 256 * 1_024),
  );

  return (store: ReduxStoreLike) =>
    (next: Next) =>
    (action: unknown): unknown => {
      const actionObject =
        action !== null && typeof action === 'object'
          ? (action as ReduxActionLike)
          : { type: String(action) };
      const actionType = typeof actionObject.type === 'string' ? actionObject.type : 'unknown';
      const actionCategory = Object.entries(options.actionCategories ?? {}).find(([, patterns]) =>
        matchesAction(actionType, patterns),
      )?.[0];
      const excluded =
        (options.actionAllowList?.length && !matchesAction(actionType, options.actionAllowList)) ||
        matchesAction(actionType, options.actionDenyList) ||
        (actionCategory &&
          options.enabledCategories?.length &&
          !options.enabledCategories.includes(actionCategory)) ||
        (options.actionFilter && !options.actionFilter(action));
      if (excluded) return next(action);
      const previousRaw = store.getState();
      const startedAt = globalThis.performance?.now?.() ?? Date.now();
      const result = next(action);
      const reducerDuration = Math.max(
        0,
        (globalThis.performance?.now?.() ?? Date.now()) - startedAt,
      );
      const nextRaw = store.getState();
      const sanitize = (value: unknown) => {
        const budget = { remainingProperties: maxStateProperties, truncated: false };
        const result = redact(toJson(value, maxStateDepth, budget), {
          fields: options.redactedFields,
        }) as JsonValue;
        const bytes = jsonBytes(result);
        return {
          value:
            bytes > maxStateBytes ? ('[State omitted: exceeds capture limit]' as const) : result,
          bytes,
          truncated: budget.truncated || bytes > maxStateBytes,
        };
      };
      const previous = sanitize(previousRaw);
      const nextStateResult = sanitize(nextRaw);
      const actionResult = sanitize(action);
      const stateDiff = captureStateDiff
        ? diffStates(previous.value, nextStateResult.value, '$', [], 10_000)
        : undefined;
      const context = options.getCorrelationContext?.(action);
      const payload: ReduxEventPayload = {
        storeId,
        actionType,
        ...(actionCategory ? { actionCategory } : {}),
        action: actionResult.value,
        reducerDuration,
        ...(captureState
          ? { previousState: previous.value, nextState: nextStateResult.value }
          : {}),
        ...(stateDiff ? { stateDiff, changedPaths: stateDiff.map(({ path }) => path) } : {}),
        stateSize: {
          previousBytes: previous.bytes,
          nextBytes: nextStateResult.bytes,
          warningThresholdBytes: warningThreshold,
          truncated: previous.truncated || nextStateResult.truncated,
        },
        ...(context
          ? {
              correlations: {
                ...(context.route ? { route: context.route } : {}),
                ...(context.requestId ? { requestId: context.requestId } : {}),
                ...(context.errorId ? { errorId: context.errorId } : {}),
                ...(context.performanceEventId
                  ? { performanceEventId: context.performanceEventId }
                  : {}),
              },
            }
          : {}),
      };
      options.client?.track({
        category: 'redux',
        type: 'redux.action',
        payload,
        ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
        ...(context?.parentId ? { parentId: context.parentId } : {}),
      });
      return result;
    };
}
