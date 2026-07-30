import { DevToolClient } from './client';
import type { DevToolConfig, TrackEventInput } from './types';

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
  get client(): DevToolClient | undefined {
    return activeClient;
  },
};

export { DevToolClient };
export { installAxiosInterceptor } from './axios-instrumentation';
export type { AxiosInstanceLike } from './axios-instrumentation';
export { serializeConsoleValue } from './serialization';
export type { DevToolConfig, TrackEventInput, WebSocketFactory, WebSocketLike } from './types';
