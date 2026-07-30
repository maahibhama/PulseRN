import { DevToolClient } from './client';
import type { CaptureErrorOptions, DevToolConfig, TrackEventInput } from './types';

let activeClient: DevToolClient | undefined;

export const ReactNativeDevTool = {
  configure(config: DevToolConfig): DevToolClient {
    activeClient?.disconnect();
    activeClient = new DevToolClient(config);
    return activeClient;
  },
  track(event: TrackEventInput): void {
    activeClient?.track(event);
  },
  captureError(error: unknown, options?: CaptureErrorOptions): void {
    activeClient?.captureError(error, options);
  },
  get client(): DevToolClient | undefined {
    return activeClient;
  },
  performance: {
    mark(name: string): void {
      activeClient?.performance.mark(name);
    },
    measure(name: string, startMark: string, endMark?: string): number | undefined {
      return activeClient?.performance.measure(name, startMark, endMark);
    },
    appStarted(name?: string): number | undefined {
      return activeClient?.performance.appStarted(name);
    },
    startScreen(name: string): void {
      activeClient?.performance.startScreen(name);
    },
    screenMounted(name: string): number | undefined {
      return activeClient?.performance.screenMounted(name);
    },
    screenInteractive(name: string): number | undefined {
      return activeClient?.performance.screenInteractive(name);
    },
    endScreen(name: string): number | undefined {
      return activeClient?.performance.endScreen(name);
    },
  },
};

export { DevToolClient };
export { installAxiosInterceptor } from './axios-instrumentation';
export type { AxiosInstanceLike } from './axios-instrumentation';
export { serializeConsoleValue } from './serialization';
export { PerformanceMonitor } from './performance-monitor';
export { installErrorInterceptor, toCapturedError } from './error-instrumentation';
export { createAsyncStorageProvider, createMMKVStorageProvider } from './storage-provider';
export type { AsyncStorageLike, MMKVLike, StorageProvider } from './storage-provider';
export type {
  CaptureErrorOptions,
  DevToolConfig,
  TrackEventInput,
  WebSocketFactory,
  WebSocketLike,
} from './types';
