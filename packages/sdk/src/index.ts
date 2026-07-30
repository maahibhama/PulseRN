import { DevToolClient } from './client.js';
import type { CaptureErrorOptions, DevToolConfig, TrackEventInput } from './types.js';

let activeClient: DevToolClient | undefined;

export function createPulseRNClient(config: DevToolConfig): DevToolClient {
  return new DevToolClient(config);
}

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
export { installAxiosInterceptor } from './axios-instrumentation.js';
export type { AxiosInstanceLike } from './axios-instrumentation.js';
export { serializeConsoleValue } from './serialization.js';
export { PerformanceMonitor } from './performance-monitor.js';
export { installErrorInterceptor, toCapturedError } from './error-instrumentation.js';
export { createAsyncStorageProvider, createMMKVStorageProvider } from './storage-provider.js';
export type { AsyncStorageLike, MMKVLike, StorageProvider } from './storage-provider.js';
export { createDevToolMiddleware, diffStates } from './redux.js';
export type { DevToolMiddlewareOptions, ReduxTrackTarget } from './redux.js';
export { createNavigationTracker, getActiveRoute } from './navigation.js';
export type {
  ManualNavigationInput,
  NavigationAction,
  NavigationRefLike,
  NavigationRouteLike,
  NavigationStateLike,
  NavigationTrackerOptions,
  NavigationTrackTarget,
} from './navigation.js';
export type {
  CaptureErrorOptions,
  DevToolConfig,
  TrackEventInput,
  WebSocketFactory,
  WebSocketLike,
} from './types.js';
