import { DevToolClient } from './client.js';
import type { CaptureErrorOptions, DevToolConfig, TrackEventInput } from './types.js';
import type { PulseRNIdentityStorage, PulseRNSessionOptions } from './identity.js';
import { getOrCreatePulseRNIdentity } from './identity.js';
export { getOrCreatePulseRNDeviceId, getOrCreatePulseRNIdentity } from './identity.js';
export type {
  PulseRNIdentityStorage,
  PulseRNSessionIdentity,
  PulseRNSessionOptions,
} from './identity.js';
export { pulseRNEventCategories, validatePulseRNConfig } from './configuration.js';

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
  async configureWithIdentity(
    config: DevToolConfig,
    storage: PulseRNIdentityStorage,
    options: PulseRNSessionOptions,
  ): Promise<DevToolClient> {
    const identity = await getOrCreatePulseRNIdentity(storage, options);
    return this.configure({ ...config, ...identity });
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
export type {
  DevToolMiddlewareOptions,
  ReduxCorrelationContext,
  ReduxTrackTarget,
} from './redux.js';
export { createNavigationTracker, getActiveRoute, getActiveRoutePath } from './navigation.js';
export type {
  ManualNavigationInput,
  NavigationAction,
  NavigationRefLike,
  NavigationRouteLike,
  NavigationStateLike,
  NavigationTrackerOptions,
  NavigationTrackTarget,
} from './navigation.js';
export type { NetworkEventPayload, NetworkLifecycleEventPayload } from './protocol-types.js';
export type {
  CaptureErrorOptions,
  ClientConnectionState,
  ClientDiagnosticSummary,
  ClientDiagnostics,
  DevToolConfig,
  DroppedEventNotice,
  DroppedEventReason,
  PulseRNEnvironment,
  TrackEventInput,
  WebSocketFactory,
  WebSocketLike,
} from './types.js';
