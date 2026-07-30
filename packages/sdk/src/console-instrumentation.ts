import type { ConsoleLogLevel, ConsoleLogPayload, JsonValue } from './protocol-types.js';
import { formatConsoleMessage, serializeConsoleValue } from './serialization';

type ConsoleMethod = (...arguments_: unknown[]) => void;
type InstrumentedConsole = Record<ConsoleLogLevel, ConsoleMethod>;

export interface ConsoleInterceptorOptions {
  captureStackTrace?: boolean;
}

const LEVELS: readonly ConsoleLogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

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
  for (const line of callerFrames) {
    const match = line.match(/\((.*):(\d+):(\d+)\)$/) ?? line.match(/^\s*at\s+(.*):(\d+):(\d+)$/);
    if (!match?.[1] || !match[2]) continue;
    return {
      stack: cleanedStack,
      source: {
        file: match[1],
        line: Number(match[2]),
        ...(match[3] ? { column: Number(match[3]) } : {}),
      },
    };
  }
  return { stack: cleanedStack };
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
        const serialized = arguments_.map((value) => serializeConsoleValue(value)) as JsonValue[];
        emit(level, {
          level,
          arguments: serialized,
          message: formatConsoleMessage(serialized),
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
