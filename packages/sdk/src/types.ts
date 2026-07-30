import type { DeviceInfo, DevToolEventCategory, JsonValue } from '@pulse-rn/protocol';

export interface DevToolConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  appName: string;
  appId?: string;
  appVersion?: string;
  deviceId?: string;
  sessionId?: string;
  device?: Partial<Omit<DeviceInfo, 'appName' | 'sdkVersion'>>;
  authToken?: string;
  batchSize?: number;
  batchIntervalMs?: number;
  maxQueueSize?: number;
  maxPayloadBytes?: number;
  reconnect?: boolean;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  allowInProduction?: boolean;
  isDevelopment?: boolean;
  enableConsole?: boolean;
  captureConsoleStackTrace?: boolean;
  enableNetwork?: boolean;
  captureRequestBodies?: boolean;
  captureResponseBodies?: boolean;
  maxNetworkBodyBytes?: number;
  enablePerformance?: boolean;
  performanceSampleIntervalMs?: number;
  javascriptStallThresholdMs?: number;
  captureMemory?: boolean;
  redaction?: {
    fields?: readonly string[];
    headers?: readonly string[];
    queryParameters?: readonly string[];
  };
}

export interface TrackEventInput {
  category: DevToolEventCategory;
  type: string;
  payload: JsonValue;
  correlationId?: string;
  parentId?: string;
}

export interface WebSocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;
