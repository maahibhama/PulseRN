import type { JsonValue } from '@pulse-rn/protocol';

export interface SerializationOptions {
  maxDepth?: number;
  maxProperties?: number;
  maxStringLength?: number;
}

const DEFAULT_OPTIONS: Required<SerializationOptions> = {
  maxDepth: 8,
  maxProperties: 200,
  maxStringLength: 20_000,
};

export function serializeConsoleValue(
  value: unknown,
  options: SerializationOptions = {},
  seen = new WeakSet<object>(),
  depth = 0,
): JsonValue {
  const limits = { ...DEFAULT_OPTIONS, ...options };
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    return value.length <= limits.maxStringLength
      ? value
      : `${value.slice(0, limits.maxStringLength)}… [truncated]`;
  }
  if (typeof value === 'undefined') return '[undefined]';
  if (typeof value === 'bigint') return `${String(value)}n`;
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (depth >= limits.maxDepth) return '[Max depth reached]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
      ...(value.cause !== undefined
        ? { cause: serializeConsoleValue(value.cause, limits, seen, depth + 1) }
        : {}),
    };
  }
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, limits.maxProperties)
      .map((item) => serializeConsoleValue(item, limits, seen, depth + 1));
  }
  if (value instanceof Map) {
    return {
      '[Map]': [...value.entries()]
        .slice(0, limits.maxProperties)
        .map(([key, item]) => [
          serializeConsoleValue(key, limits, seen, depth + 1),
          serializeConsoleValue(item, limits, seen, depth + 1),
        ]),
    };
  }
  if (value instanceof Set) {
    return {
      '[Set]': [...value.values()]
        .slice(0, limits.maxProperties)
        .map((item) => serializeConsoleValue(item, limits, seen, depth + 1)),
    };
  }

  const result: Record<string, JsonValue> = {};
  const allKeys = Object.keys(value);
  for (const key of allKeys.slice(0, limits.maxProperties)) {
    try {
      result[key] = serializeConsoleValue(
        (value as Record<string, unknown>)[key],
        limits,
        seen,
        depth + 1,
      );
    } catch (error) {
      result[key] = `[Thrown while reading: ${error instanceof Error ? error.message : 'unknown'}]`;
    }
  }
  if (allKeys.length > limits.maxProperties) {
    result['[Truncated]'] = `${allKeys.length - limits.maxProperties} more properties`;
  }
  return result;
}

export function formatConsoleMessage(values: readonly JsonValue[]): string {
  return values
    .map((value) => {
      if (typeof value === 'string') return value;
      if (
        value !== null &&
        !Array.isArray(value) &&
        typeof value === 'object' &&
        typeof value['name'] === 'string' &&
        typeof value['message'] === 'string'
      ) {
        return `${value['name']}: ${value['message']}`;
      }
      return JSON.stringify(value);
    })
    .join(' ');
}
