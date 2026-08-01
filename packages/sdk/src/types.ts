import type { DeviceInfo, DevToolEventCategory, JsonValue } from './protocol-types.js';

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
  pairingCode?: string;
  reconnectToken?: string;
  onReconnectToken?: (token: string) => void;
  batchSize?: number;
  batchIntervalMs?: number;
  maxQueueSize?: number;
  maxPayloadBytes?: number;
  reconnect?: boolean;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  diagnosticsIntervalMs?: number;
  maxSocketBufferBytes?: number;
  onDiagnostics?: (diagnostics: ClientDiagnostics) => void;
  allowInProduction?: boolean;
  isDevelopment?: boolean;
  enableConsole?: boolean;
  captureConsoleStackTrace?: boolean;
  maxConsoleEventsPerMinute?: number;
  consoleSerialization?: {
    maxDepth?: number;
    maxProperties?: number;
    maxStringLength?: number;
  };
  enableNetwork?: boolean;
  captureRequestBodies?: boolean;
  captureResponseBodies?: boolean;
  maxNetworkBodyBytes?: number;
  maxNetworkRequestBytes?: number;
  maxNetworkSessionBytes?: number;
  enablePerformance?: boolean;
  performanceSampleIntervalMs?: number;
  javascriptStallThresholdMs?: number;
  captureMemory?: boolean;
  enableStorage?: boolean;
  enableErrors?: boolean;
  redaction?: {
    fields?: readonly string[];
    headers?: readonly string[];
    queryParameters?: readonly string[];
  };
}

export interface ClientDiagnostics {
  connected: boolean;
  queuedEvents: number;
  droppedEvents: number;
  oversizedEvents: number;
  queueOverflowEvents: number;
  consoleDroppedEvents: number;
  sentEvents: number;
  sentBatches: number;
  reconnectAttempts: number;
  socketBufferedBytes: number;
  clockOffsetMs: number;
  lastEventAt?: number;
}

export interface TrackEventInput {
  category: DevToolEventCategory;
  type: string;
  payload: JsonValue;
  correlationId?: string;
  parentId?: string;
}

export interface CaptureErrorOptions {
  source?: 'react_boundary' | 'manual' | 'sdk_internal' | 'unhandled_rejection';
  fatal?: boolean;
  componentStack?: string;
  metadata?: JsonValue;
}

export interface WebSocketLike {
  readonly readyState: number;
  readonly bufferedAmount?: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;
