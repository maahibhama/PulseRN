import { DevToolClient } from './client.js';
import type { DevToolConfig, TrackEventInput } from './types.js';

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
export { installAxiosInterceptor } from './axios-instrumentation.js';
export type { AxiosInstanceLike } from './axios-instrumentation.js';
export { serializeConsoleValue } from './serialization.js';
export type { DevToolConfig, TrackEventInput, WebSocketFactory, WebSocketLike } from './types.js';
