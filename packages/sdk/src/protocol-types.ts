export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue | undefined };

type JsonObject = Record<string, JsonValue | undefined>;

export type DevToolEventCategory =
  | 'console'
  | 'network'
  | 'redux'
  | 'navigation'
  | 'performance'
  | 'storage'
  | 'error'
  | 'device'
  | 'interaction'
  | 'system';

export type ConsoleLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleLogPayload extends JsonObject {
  level: ConsoleLogLevel;
  arguments: JsonValue[];
  message: string;
  stack?: string;
  source?: { file: string; line: number; column?: number };
}

export interface NetworkBody extends JsonObject {
  value: JsonValue;
  size: number;
  truncated: boolean;
  contentType?: string;
}

export interface NetworkEventPayload extends JsonObject {
  requestId: string;
  transport: 'fetch' | 'xhr' | 'axios';
  method: string;
  url: string;
  query: Record<string, string | string[]>;
  requestHeaders: Record<string, string>;
  requestBody?: NetworkBody;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: NetworkBody;
  startedAt: number;
  endedAt: number;
  duration: number;
  error?: { name: string; message: string };
}

export interface ReduxStateDiff extends JsonObject {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: JsonValue;
  after?: JsonValue;
}

export interface ReduxEventPayload extends JsonObject {
  storeId: string;
  actionType: string;
  action: JsonValue;
  previousState?: JsonValue;
  nextState?: JsonValue;
  stateDiff?: ReduxStateDiff[];
  reducerDuration: number;
}

export interface NavigationRoute extends JsonObject {
  key?: string;
  name: string;
  path?: string;
  params?: JsonValue;
}

export interface NavigationEventPayload extends JsonObject {
  navigatorId: string;
  source: 'react-navigation' | 'expo-router' | 'manual';
  lifecycle: 'ready' | 'state' | 'focus' | 'blur';
  action: 'navigate' | 'push' | 'pop' | 'replace' | 'reset' | 'back' | 'unknown';
  previousRoute?: NavigationRoute;
  currentRoute?: NavigationRoute;
  previousRouteDuration?: number;
}

export type PerformanceMetric =
  | 'js_fps'
  | 'event_loop_lag'
  | 'js_stall'
  | 'long_task'
  | 'app_start'
  | 'screen_mount'
  | 'screen_interactive'
  | 'screen_duration'
  | 'custom_measure'
  | 'memory';

export interface PerformanceEventPayload extends JsonObject {
  metric: PerformanceMetric;
  name: string;
  value: number;
  unit: 'ms' | 'fps' | 'bytes';
  approximate: boolean;
  startedAt?: number;
  endedAt?: number;
  metadata?: JsonValue;
}

export type StorageOperation = 'providers' | 'list' | 'get' | 'set' | 'delete';

export interface StorageEventPayload extends JsonObject {
  requestId: string;
  providerId: string;
  operation: StorageOperation;
  key?: string;
  success: boolean;
  mutation: boolean;
  duration: number;
  error?: string;
}

export type ErrorSource =
  'uncaught' | 'unhandled_rejection' | 'react_boundary' | 'network' | 'sdk_internal' | 'manual';

export interface ErrorContextEvent extends JsonObject {
  id: string;
  timestamp: number;
  sequence: number;
  category: DevToolEventCategory;
  type: string;
  summary?: string;
  correlationId?: string;
}

export interface ErrorEventPayload extends JsonObject {
  source: ErrorSource;
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
  screen?: string;
  fatal: boolean;
  context: ErrorContextEvent[];
  metadata?: JsonValue;
}

export interface DevToolEventEnvelope<TPayload extends JsonValue = JsonValue> {
  id: string;
  protocolVersion: string;
  sessionId: string;
  deviceId: string;
  appId: string;
  timestamp: number;
  sequence: number;
  category: DevToolEventCategory;
  type: string;
  payload: TPayload;
  correlationId?: string;
  parentId?: string;
}

export interface DeviceInfo {
  name: string;
  platform: 'ios' | 'android' | 'unknown';
  platformVersion?: string;
  model?: string;
  appName: string;
  appVersion?: string;
  sdkVersion: string;
}

export interface ClientHello {
  kind: 'client-hello';
  supportedProtocolVersions: string[];
  sessionId: string;
  deviceId: string;
  appId: string;
  device: DeviceInfo;
  authToken?: string;
}

export interface EventBatch {
  kind: 'event-batch';
  events: DevToolEventEnvelope[];
}

export interface StorageCommand {
  kind: 'storage-command';
  requestId: string;
  providerId: string;
  operation: StorageOperation;
  key?: string;
  value?: string;
}

export interface StorageResult {
  kind: 'storage-result';
  requestId: string;
  providerId: string;
  operation: StorageOperation;
  success: boolean;
  providers?: { id: string; name: string }[];
  keys?: string[];
  value?: string | null;
  error?: string;
}
