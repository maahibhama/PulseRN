import type { ErrorEventPayload, ErrorSource, JsonValue } from './protocol-types.js';

export interface CapturedError extends Pick<
  ErrorEventPayload,
  'classification' | 'fingerprint' | 'frames'
> {
  source: ErrorSource;
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
  fatal: boolean;
  metadata?: JsonValue;
}

interface ErrorUtilsLike {
  getGlobalHandler?(): (error: unknown, fatal?: boolean) => void;
  setGlobalHandler?(handler: (error: unknown, fatal?: boolean) => void): void;
}

interface EventTargetLike {
  addEventListener?(type: string, listener: (event: unknown) => void): void;
  removeEventListener?(type: string, listener: (event: unknown) => void): void;
}

function describeError(value: unknown): Pick<CapturedError, 'name' | 'message' | 'stack'> {
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }
  if (typeof value === 'string') return { name: 'Error', message: value };
  try {
    return { name: 'Error', message: JSON.stringify(value) ?? String(value) };
  } catch {
    return { name: 'Error', message: String(value) };
  }
}

function isApplicationFile(file: string): boolean {
  const normalized = file.toLowerCase();
  return !(
    normalized.includes('node_modules') ||
    normalized.includes('/react-native/') ||
    normalized.includes('[native code]') ||
    normalized.startsWith('native') ||
    normalized.includes('internal/')
  );
}

export function parseErrorFrames(
  stack: string | undefined,
  componentStack?: string,
): NonNullable<ErrorEventPayload['frames']> {
  const frames: NonNullable<ErrorEventPayload['frames']> = [];
  for (const line of stack?.split('\n') ?? []) {
    const match =
      /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line) ??
      /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/.exec(line);
    if (!match?.[2]) continue;
    const file = match[2];
    frames.push({
      ...(match[1] ? { functionName: match[1] } : {}),
      file,
      line: Number(match[3]),
      column: Number(match[4]),
      application: isApplicationFile(file),
      symbolicated: /\.(?:[cm]?[jt]sx?|vue)(?:[?#]|$)/i.test(file),
    });
  }
  for (const line of componentStack?.split('\n') ?? []) {
    const match = /^\s*(?:in|at)\s+(.+?)(?:\s+\(at\s+(.+?):(\d+)(?::(\d+))?\))?\s*$/.exec(line);
    if (!match?.[2]) continue;
    const file = match[2];
    frames.push({
      ...(match[1] ? { functionName: match[1] } : {}),
      file,
      line: Number(match[3]),
      ...(match[4] ? { column: Number(match[4]) } : {}),
      application: isApplicationFile(file),
      symbolicated: true,
    });
  }
  return frames.slice(0, 500);
}

function stableHash(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function fingerprintCapturedError(
  error: Pick<CapturedError, 'name' | 'message'>,
  frames: NonNullable<ErrorEventPayload['frames']>,
): string {
  const normalizedMessage = error.message
    .toLowerCase()
    .replaceAll(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<uuid>')
    .replaceAll(/0x[0-9a-f]+/gi, '<hex>')
    .replaceAll(/\b\d+(?:\.\d+)?\b/g, '<number>')
    .replaceAll(/\s+/g, ' ')
    .trim();
  const frameKey = frames
    .filter((frame) => frame.application)
    .slice(0, 5)
    .map((frame) => `${frame.functionName ?? '<anonymous>'}@${frame.file.split(/[\\/]/).pop()}`)
    .join('|');
  const input = `${error.name.toLowerCase()}|${normalizedMessage}|${frameKey}`;
  return `${stableHash(input, 2_166_136_261)}${stableHash(input, 3_332_664_777)}`;
}

export function toCapturedError(
  error: unknown,
  source: ErrorSource,
  options: {
    fatal?: boolean;
    componentStack?: string;
    metadata?: JsonValue;
    classification?: NonNullable<ErrorEventPayload['classification']>;
  } = {},
): CapturedError {
  const described = describeError(error);
  const frames = parseErrorFrames(described.stack, options.componentStack);
  const captured: CapturedError = {
    source,
    classification: options.classification ?? (source === 'sdk_internal' ? 'sdk' : 'application'),
    ...described,
    frames,
    fingerprint: fingerprintCapturedError(described, frames),
    fatal: options.fatal ?? false,
    ...(options.componentStack ? { componentStack: options.componentStack } : {}),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
  return captured;
}

export function installErrorInterceptor(
  target: typeof globalThis & { ErrorUtils?: ErrorUtilsLike },
  emit: (error: CapturedError) => void,
): () => void {
  const restores: Array<() => void> = [];
  const errorUtils = target.ErrorUtils;
  if (errorUtils?.setGlobalHandler) {
    const originalHandler = errorUtils.getGlobalHandler?.();
    errorUtils.setGlobalHandler((error, fatal = false) => {
      emit(toCapturedError(error, 'uncaught', { fatal }));
      originalHandler?.(error, fatal);
    });
    restores.push(() => {
      if (originalHandler) errorUtils.setGlobalHandler?.(originalHandler);
    });
  }

  const eventTarget = target as EventTargetLike;
  if (eventTarget.addEventListener && eventTarget.removeEventListener) {
    const onError = (event: unknown) => {
      const value = event as { error?: unknown; message?: string };
      emit(toCapturedError(value.error ?? value.message ?? event, 'uncaught', { fatal: true }));
    };
    const onUnhandledRejection = (event: unknown) => {
      const value = event as { reason?: unknown };
      emit(toCapturedError(value.reason ?? event, 'unhandled_rejection'));
    };
    eventTarget.addEventListener('error', onError);
    eventTarget.addEventListener('unhandledrejection', onUnhandledRejection);
    restores.push(() => {
      eventTarget.removeEventListener?.('error', onError);
      eventTarget.removeEventListener?.('unhandledrejection', onUnhandledRejection);
    });
  }

  return () => {
    for (const restore of restores.reverse()) restore();
  };
}
