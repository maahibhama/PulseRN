import type { ErrorSource, JsonValue } from '@pulse-rn/protocol';

export interface CapturedError {
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

export function toCapturedError(
  error: unknown,
  source: ErrorSource,
  options: {
    fatal?: boolean;
    componentStack?: string;
    metadata?: JsonValue;
  } = {},
): CapturedError {
  return {
    source,
    ...describeError(error),
    fatal: options.fatal ?? false,
    ...(options.componentStack ? { componentStack: options.componentStack } : {}),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
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
