export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue | undefined };

type JsonObject = Record<string, JsonValue | undefined>;

export type DevToolEventCategory =
  | 'console'
  | 'native-log'
  | 'network'
  | 'redux'
  | 'navigation'
  | 'performance'
  | 'animation'
  | 'worklet'
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
  redacted?: boolean;
  truncated?: boolean;
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
  timingAccuracy?: 'measured' | 'approximate';
  initiator?: string;
  redirectChain?: {
    from: string;
    to: string;
    status?: number;
    at: number;
  }[];
  capture?: {
    requestBudgetBytes: number;
    sessionBudgetBytes: number;
    omittedBodies: ('request' | 'response')[];
  };
}

export interface NetworkLifecycleEventPayload extends JsonObject {
  phase: 'start' | 'progress' | 'redirect' | 'complete' | 'failure';
  requestId: string;
  transport: 'fetch' | 'xhr' | 'axios';
  method: string;
  url: string;
  timestamp: number;
  startedAt: number;
  status?: number;
  loadedBytes?: number;
  totalBytes?: number;
  redirectFrom?: string;
  redirectTo?: string;
  initiator?: string;
  timingAccuracy: 'measured' | 'approximate';
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
  actionCategory?: string;
  action: JsonValue;
  previousState?: JsonValue;
  nextState?: JsonValue;
  stateDiff?: ReduxStateDiff[];
  changedPaths?: string[];
  stateSize?: {
    previousBytes: number;
    nextBytes: number;
    warningThresholdBytes: number;
    truncated: boolean;
  };
  correlations?: {
    route?: string;
    requestId?: string;
    errorId?: string;
    performanceEventId?: string;
  };
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
  routePath?: string[];
  routeTree?: {
    navigatorId: string;
    parentNavigatorId?: string;
    route: NavigationRoute;
    active: boolean;
    depth: number;
  }[];
  parameterDiff?: ReduxStateDiff[];
  actionGroup?: 'forward' | 'backward' | 'reset' | 'lifecycle' | 'unknown';
  warnings?: ('duplicate_navigator_id' | 'incomplete_tracking' | 'inconsistent_ancestry')[];
  integrationMetadata?: JsonValue;
  correlations?: {
    requestId?: string;
    reduxEventId?: string;
    performanceEventId?: string;
    consoleEventId?: string;
    errorId?: string;
  };
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
  | 'memory'
  | 'capability';

export interface PerformanceEventPayload extends JsonObject {
  metric: PerformanceMetric;
  name: string;
  value: number;
  unit: 'ms' | 'fps' | 'bytes' | 'count';
  approximate: boolean;
  startedAt?: number;
  endedAt?: number;
  metadata?: JsonValue;
  sampling?: {
    intervalMs: number;
    expectedSamples: number;
    lostSamples: number;
    captureRate: number;
  };
  provenance?: 'javascript' | 'runtime';
  capability?: {
    name: 'animation_frame' | 'js_heap' | 'native_cpu' | 'ui_thread' | 'native_memory';
    status: 'available' | 'unavailable';
    reason?: string;
  };
}

export type RuntimeKind = 'react-native' | 'ui' | 'worker';
export type AnimationType =
  | 'timing'
  | 'spring'
  | 'decay'
  | 'keyframe'
  | 'entering'
  | 'exiting'
  | 'layout'
  | 'shared-transition'
  | 'custom';
export type AnimationPhase =
  'created' | 'scheduled' | 'started' | 'running' | 'completed' | 'cancelled' | 'failed';

export type StorageOperation = 'providers' | 'list' | 'get' | 'set' | 'delete' | 'restore';

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
  classification?: 'application' | 'sdk' | 'debugger' | 'connection' | 'desktop_internal';
  name: string;
  message: string;
  fingerprint?: string;
  stack?: string;
  componentStack?: string;
  frames?: {
    functionName?: string;
    file: string;
    line?: number;
    column?: number;
    application: boolean;
    symbolicated: boolean;
  }[];
  screen?: string;
  appVersion?: string;
  fatal: boolean;
  context: ErrorContextEvent[];
  correlations?: {
    route?: string;
    requestId?: string;
    reduxEventId?: string;
    consoleEventId?: string;
    performanceEventId?: string;
  };
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
  nativeTargetId?: string;
}

export interface ClientHello {
  kind: 'client-hello';
  supportedProtocolVersions: string[];
  sessionId: string;
  deviceId: string;
  appId: string;
  device: DeviceInfo;
  authToken?: string;
  pairingCode?: string;
  reconnectToken?: string;
}

export interface EventBatch {
  kind: 'event-batch';
  events: DevToolEventEnvelope[];
}

export interface ClientHealth {
  kind: 'client-health';
  sentAt: number;
  queuedEvents: number;
  droppedEvents: number;
  oversizedEvents: number;
  queueOverflowEvents: number;
  consoleDroppedEvents?: number;
  sentEvents: number;
  sentBatches: number;
  reconnectAttempts: number;
  socketBufferedBytes: number;
  clockOffsetMs: number;
  lastEventAt?: number;
}

export interface StorageCommand {
  kind: 'storage-command';
  requestId: string;
  providerId: string;
  operation: StorageOperation;
  key?: string;
  value?: string;
  cursor?: string;
  limit?: number;
  backupId?: string;
}

export interface StorageResult {
  kind: 'storage-result';
  requestId: string;
  providerId: string;
  operation: StorageOperation;
  success: boolean;
  providers?: {
    id: string;
    name: string;
    capabilities?: StorageProviderCapabilities;
  }[];
  keys?: string[];
  keyEntries?: {
    key: string;
    valueSize?: number;
    valueType: StorageValueType;
    sensitive: boolean;
  }[];
  nextCursor?: string;
  totalKeys?: number;
  value?: string | null;
  valueSize?: number;
  valueType?: StorageValueType;
  sensitive?: boolean;
  redacted?: boolean;
  backupId?: string;
  error?: string;
}

export type StorageValueType = 'string' | 'number' | 'boolean' | 'json' | 'binary' | 'unknown';
export interface StorageProviderCapabilities {
  paginatedKeys: boolean;
  lazyValues: boolean;
  mutations: boolean;
  typedValues: boolean;
  snapshots: boolean;
}
