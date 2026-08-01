import type { ConsoleLogLevel, ConsoleLogPayload, JsonValue } from './protocol-types.js';
import {
  formatConsoleMessage,
  serializeConsoleValue,
  type SerializationOptions,
} from './serialization';

type ConsoleMethod = (...arguments_: unknown[]) => void;
type InstrumentedConsole = Record<ConsoleLogLevel, ConsoleMethod>;

export interface ConsoleInterceptorOptions {
  captureStackTrace?: boolean;
  serialization?: SerializationOptions;
}

const LEVELS: readonly ConsoleLogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

export function parseConsoleStackSource(stack: string): ConsoleLogPayload['source'] | undefined {
  for (const line of stack.split('\n')) {
    const match = line.match(
      /\(?((?:file:\/\/|https?:\/\/|webpack:\/\/|metro:\/\/|\/|[A-Za-z]:[\\/]).*?):(\d+):(\d+)\)?$/,
    );
    if (!match?.[1] || !match[2]) continue;
    return {
      file: match[1],
      line: Number(match[2]),
      ...(match[3] ? { column: Number(match[3]) } : {}),
    };
  }
  return undefined;
}

function captureStack(): Pick<ConsoleLogPayload, 'stack' | 'source'> {
  const stack = new Error().stack;
  if (!stack) return {};
  const lines = stack
    .split('\n')
    .filter(
      (line) =>
        !line.includes('console-instrumentation') &&
        !line.includes('DevToolClient') &&
        !line.includes('captureStack'),
    );
  const [heading = 'Error', ...frames] = lines;
  // The first remaining frame is the wrapped console method. Hermes bundles may
  // name it "anonymous", so it cannot reliably be filtered by function name.
  const callerFrames = frames.slice(1);
  const cleanedStack = [heading, ...callerFrames].join('\n');
  const source = parseConsoleStackSource(cleanedStack);
  return { stack: cleanedStack, ...(source ? { source } : {}) };
}

export function installConsoleInterceptor(
  target: InstrumentedConsole,
  emit: (level: ConsoleLogLevel, payload: ConsoleLogPayload) => void,
  options: ConsoleInterceptorOptions = {},
): () => void {
  const originals = new Map<ConsoleLogLevel, ConsoleMethod>();
  let capturing = false;

  for (const level of LEVELS) {
    const original = target[level];
    originals.set(level, original);
    target[level] = (...arguments_: unknown[]) => {
      original.apply(target, arguments_);
      if (capturing) return;
      capturing = true;
      try {
        const serialized = arguments_.map((value) =>
          serializeConsoleValue(value, options.serialization),
        ) as JsonValue[];
        const serializedText = JSON.stringify(serialized);
        emit(level, {
          level,
          arguments: serialized,
          message: formatConsoleMessage(serialized),
          ...(serializedText.includes('[truncated]') ||
          serializedText.includes('[Truncated]') ||
          serializedText.includes('[Max depth reached]')
            ? { truncated: true }
            : {}),
          ...(options.captureStackTrace ? captureStack() : {}),
        });
      } finally {
        capturing = false;
      }
    };
  }

  return () => {
    for (const [level, original] of originals) target[level] = original;
  };
}
