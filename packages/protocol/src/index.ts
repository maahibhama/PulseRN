import { z } from 'zod';

export const PROTOCOL_VERSION = '1.0.0';
export const SUPPORTED_PROTOCOL_VERSIONS = [PROTOCOL_VERSION] as const;

export const eventCategorySchema = z.enum([
  'console',
  'network',
  'redux',
  'navigation',
  'performance',
  'storage',
  'error',
  'device',
  'interaction',
  'system',
]);
export type DevToolEventCategory = z.infer<typeof eventCategorySchema>;

const identifier = z.string().trim().min(1).max(256);
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue)]),
);

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const consoleLogLevelSchema = z.enum(['log', 'info', 'warn', 'error', 'debug']);
export type ConsoleLogLevel = z.infer<typeof consoleLogLevelSchema>;

export const consoleLogPayloadSchema = z.object({
  level: consoleLogLevelSchema,
  arguments: z.array(jsonValue).max(100),
  message: z.string().max(100_000),
  redacted: z.boolean().optional(),
  truncated: z.boolean().optional(),
  stack: z.string().max(100_000).optional(),
  source: z
    .object({
      file: z.string().max(4_096),
      line: z.number().int().positive(),
      column: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export type ConsoleLogPayload = z.infer<typeof consoleLogPayloadSchema>;

export const networkHeadersSchema = z.record(z.string().max(100_000));
export const networkBodySchema = z.object({
  value: jsonValue,
  size: z.number().int().nonnegative(),
  truncated: z.boolean(),
  contentType: z.string().max(1_024).optional(),
});
export const networkEventPayloadSchema = z.object({
  requestId: identifier,
  transport: z.enum(['fetch', 'xhr', 'axios']),
  method: z.string().trim().min(1).max(32),
  url: z.string().max(100_000),
  query: z.record(z.union([z.string(), z.array(z.string())])),
  requestHeaders: networkHeadersSchema,
  requestBody: networkBodySchema.optional(),
  status: z.number().int().min(0).max(999).optional(),
  statusText: z.string().max(4_096).optional(),
  responseHeaders: networkHeadersSchema.optional(),
  responseBody: networkBodySchema.optional(),
  startedAt: z.number().finite().nonnegative(),
  endedAt: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(),
  error: z
    .object({
      name: z.string().max(1_024),
      message: z.string().max(100_000),
    })
    .optional(),
  timingAccuracy: z.enum(['measured', 'approximate']).optional(),
  initiator: z.string().max(100_000).optional(),
  redirectChain: z
    .array(
      z.object({
        from: z.string().max(100_000),
        to: z.string().max(100_000),
        status: z.number().int().min(300).max(399).optional(),
        at: z.number().finite().nonnegative(),
      }),
    )
    .max(20)
    .optional(),
  capture: z
    .object({
      requestBudgetBytes: z.number().int().nonnegative(),
      sessionBudgetBytes: z.number().int().nonnegative(),
      omittedBodies: z.array(z.enum(['request', 'response'])).max(2),
    })
    .optional(),
});
export type NetworkEventPayload = z.infer<typeof networkEventPayloadSchema>;

export const networkLifecycleEventPayloadSchema = z.object({
  phase: z.enum(['start', 'progress', 'redirect', 'complete', 'failure']),
  requestId: identifier,
  transport: z.enum(['fetch', 'xhr', 'axios']),
  method: z.string().trim().min(1).max(32),
  url: z.string().max(100_000),
  timestamp: z.number().finite().nonnegative(),
  startedAt: z.number().finite().nonnegative(),
  status: z.number().int().min(0).max(999).optional(),
  loadedBytes: z.number().finite().nonnegative().optional(),
  totalBytes: z.number().finite().nonnegative().optional(),
  redirectFrom: z.string().max(100_000).optional(),
  redirectTo: z.string().max(100_000).optional(),
  initiator: z.string().max(100_000).optional(),
  timingAccuracy: z.enum(['measured', 'approximate']),
  error: z
    .object({
      name: z.string().max(1_024),
      message: z.string().max(100_000),
    })
    .optional(),
});
export type NetworkLifecycleEventPayload = z.infer<typeof networkLifecycleEventPayloadSchema>;

export const reduxStateDiffSchema = z.object({
  path: z.string().max(4_096),
  kind: z.enum(['added', 'removed', 'changed']),
  before: jsonValue.optional(),
  after: jsonValue.optional(),
});
export const reduxEventPayloadSchema = z.object({
  storeId: identifier,
  actionType: z.string().max(4_096),
  actionCategory: identifier.optional(),
  action: jsonValue,
  previousState: jsonValue.optional(),
  nextState: jsonValue.optional(),
  stateDiff: z.array(reduxStateDiffSchema).max(10_000).optional(),
  changedPaths: z.array(z.string().max(4_096)).max(10_000).optional(),
  stateSize: z
    .object({
      previousBytes: z.number().int().nonnegative(),
      nextBytes: z.number().int().nonnegative(),
      warningThresholdBytes: z.number().int().positive(),
      truncated: z.boolean(),
    })
    .optional(),
  correlations: z
    .object({
      route: z.string().max(4_096).optional(),
      requestId: identifier.optional(),
      errorId: identifier.optional(),
      performanceEventId: identifier.optional(),
    })
    .optional(),
  reducerDuration: z.number().finite().nonnegative(),
});
export type ReduxStateDiff = z.infer<typeof reduxStateDiffSchema>;
export type ReduxEventPayload = z.infer<typeof reduxEventPayloadSchema>;

export const navigationRouteSchema = z.object({
  key: z.string().max(1_024).optional(),
  name: z.string().min(1).max(1_024),
  path: z.string().max(10_000).optional(),
  params: jsonValue.optional(),
});
export const navigationEventPayloadSchema = z.object({
  navigatorId: identifier,
  source: z.enum(['react-navigation', 'expo-router', 'manual']),
  lifecycle: z.enum(['ready', 'state', 'focus', 'blur']),
  action: z.enum(['navigate', 'push', 'pop', 'replace', 'reset', 'back', 'unknown']),
  previousRoute: navigationRouteSchema.optional(),
  currentRoute: navigationRouteSchema.optional(),
  previousRouteDuration: z.number().finite().nonnegative().optional(),
  routePath: z.array(z.string().min(1).max(1_024)).max(100).optional(),
  routeTree: z
    .array(
      z.object({
        navigatorId: identifier,
        parentNavigatorId: identifier.optional(),
        route: navigationRouteSchema,
        active: z.boolean(),
        depth: z.number().int().nonnegative().max(100),
      }),
    )
    .max(1_000)
    .optional(),
  parameterDiff: z.array(reduxStateDiffSchema).max(1_000).optional(),
  actionGroup: z.enum(['forward', 'backward', 'reset', 'lifecycle', 'unknown']).optional(),
  warnings: z
    .array(z.enum(['duplicate_navigator_id', 'incomplete_tracking', 'inconsistent_ancestry']))
    .max(3)
    .optional(),
  integrationMetadata: jsonValue.optional(),
  correlations: z
    .object({
      requestId: identifier.optional(),
      reduxEventId: identifier.optional(),
      performanceEventId: identifier.optional(),
      consoleEventId: identifier.optional(),
      errorId: identifier.optional(),
    })
    .optional(),
});
export type NavigationRoute = z.infer<typeof navigationRouteSchema>;
export type NavigationEventPayload = z.infer<typeof navigationEventPayloadSchema>;

export const performanceMetricSchema = z.enum([
  'js_fps',
  'event_loop_lag',
  'js_stall',
  'long_task',
  'app_start',
  'screen_mount',
  'screen_interactive',
  'screen_duration',
  'custom_measure',
  'memory',
  'capability',
]);
export type PerformanceMetric = z.infer<typeof performanceMetricSchema>;
export const performanceEventPayloadSchema = z.object({
  metric: performanceMetricSchema,
  name: z.string().min(1).max(4_096),
  value: z.number().finite().nonnegative(),
  unit: z.enum(['ms', 'fps', 'bytes', 'count']),
  approximate: z.boolean(),
  startedAt: z.number().finite().nonnegative().optional(),
  endedAt: z.number().finite().nonnegative().optional(),
  metadata: jsonValue.optional(),
  sampling: z
    .object({
      intervalMs: z.number().finite().positive(),
      expectedSamples: z.number().int().nonnegative(),
      lostSamples: z.number().int().nonnegative(),
      captureRate: z.number().finite().min(0).max(1),
    })
    .optional(),
  provenance: z.enum(['javascript', 'runtime']).optional(),
  capability: z
    .object({
      name: z.enum(['animation_frame', 'js_heap', 'native_cpu', 'ui_thread', 'native_memory']),
      status: z.enum(['available', 'unavailable']),
      reason: z.string().max(4_096).optional(),
    })
    .optional(),
});
export type PerformanceEventPayload = z.infer<typeof performanceEventPayloadSchema>;

export const storageOperationSchema = z.enum(['providers', 'list', 'get', 'set', 'delete']);
export type StorageOperation = z.infer<typeof storageOperationSchema>;
export const storageEventPayloadSchema = z.object({
  requestId: identifier,
  providerId: identifier,
  operation: storageOperationSchema,
  key: z.string().max(10_000).optional(),
  success: z.boolean(),
  mutation: z.boolean(),
  duration: z.number().finite().nonnegative(),
  error: z.string().max(10_000).optional(),
});
export type StorageEventPayload = z.infer<typeof storageEventPayloadSchema>;

export const errorSourceSchema = z.enum([
  'uncaught',
  'unhandled_rejection',
  'react_boundary',
  'network',
  'sdk_internal',
  'manual',
]);
export type ErrorSource = z.infer<typeof errorSourceSchema>;
export const errorContextEventSchema = z.object({
  id: identifier,
  timestamp: z.number().finite().nonnegative(),
  sequence: z.number().int().nonnegative(),
  category: eventCategorySchema,
  type: identifier,
  summary: z.string().max(10_000).optional(),
  correlationId: identifier.optional(),
});
export const errorEventPayloadSchema = z.object({
  source: errorSourceSchema,
  name: z.string().min(1).max(1_024),
  message: z.string().max(100_000),
  stack: z.string().max(200_000).optional(),
  componentStack: z.string().max(200_000).optional(),
  screen: z.string().max(4_096).optional(),
  fatal: z.boolean(),
  context: z.array(errorContextEventSchema).max(20),
  metadata: jsonValue.optional(),
});
export type ErrorContextEvent = z.infer<typeof errorContextEventSchema>;
export type ErrorEventPayload = z.infer<typeof errorEventPayloadSchema>;

export const eventEnvelopeSchema = z
  .object({
    id: identifier,
    protocolVersion: identifier,
    sessionId: identifier,
    deviceId: identifier,
    appId: identifier,
    timestamp: z.number().finite().nonnegative(),
    sequence: z.number().int().nonnegative(),
    category: eventCategorySchema,
    type: identifier,
    payload: jsonValue,
    correlationId: identifier.optional(),
    parentId: identifier.optional(),
  })
  .superRefine((event, context) => {
    const payloadSchema =
      event.category === 'console'
        ? consoleLogPayloadSchema
        : event.category === 'network'
          ? z.union([networkEventPayloadSchema, networkLifecycleEventPayloadSchema])
          : event.category === 'redux'
            ? reduxEventPayloadSchema
            : event.category === 'navigation'
              ? navigationEventPayloadSchema
              : event.category === 'performance'
                ? performanceEventPayloadSchema
                : event.category === 'storage'
                  ? storageEventPayloadSchema
                  : event.category === 'error'
                    ? errorEventPayloadSchema
                    : undefined;
    if (payloadSchema && !payloadSchema.safeParse(event.payload).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payload'],
        message: `Invalid ${event.category} event payload`,
      });
    }
  });

export type DevToolEventEnvelope<TPayload extends JsonValue = JsonValue> = Omit<
  z.infer<typeof eventEnvelopeSchema>,
  'payload'
> & { payload: TPayload };

export const deviceInfoSchema = z.object({
  name: identifier,
  platform: z.enum(['ios', 'android', 'unknown']),
  platformVersion: z.string().max(128).optional(),
  model: z.string().max(256).optional(),
  appName: identifier,
  appVersion: z.string().max(128).optional(),
  sdkVersion: identifier,
});
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

export const clientHelloSchema = z.object({
  kind: z.literal('client-hello'),
  supportedProtocolVersions: z.array(identifier).min(1).max(10),
  sessionId: identifier,
  deviceId: identifier,
  appId: identifier,
  device: deviceInfoSchema,
  authToken: z.string().max(1024).optional(),
  pairingCode: z.string().max(64).optional(),
  reconnectToken: z.string().max(1024).optional(),
});
export type ClientHello = z.infer<typeof clientHelloSchema>;

export const serverHelloSchema = z.object({
  kind: z.literal('server-hello'),
  accepted: z.boolean(),
  protocolVersion: identifier.optional(),
  connectionId: identifier.optional(),
  reason: z.string().max(1024).optional(),
  serverTime: z.number().finite().nonnegative(),
  capabilities: z.array(identifier).max(100).optional(),
  reconnectToken: z.string().max(1024).optional(),
  trustStatus: z.enum(['loopback', 'paired', 'trusted']).optional(),
});
export type ServerHello = z.infer<typeof serverHelloSchema>;

export const clientHealthSchema = z.object({
  kind: z.literal('client-health'),
  sentAt: z.number().finite().nonnegative(),
  queuedEvents: z.number().int().nonnegative(),
  droppedEvents: z.number().int().nonnegative(),
  oversizedEvents: z.number().int().nonnegative(),
  queueOverflowEvents: z.number().int().nonnegative(),
  consoleDroppedEvents: z.number().int().nonnegative().optional(),
  sentEvents: z.number().int().nonnegative(),
  sentBatches: z.number().int().nonnegative(),
  reconnectAttempts: z.number().int().nonnegative(),
  socketBufferedBytes: z.number().finite().nonnegative(),
  clockOffsetMs: z.number().finite(),
  lastEventAt: z.number().finite().nonnegative().optional(),
});
export type ClientHealth = z.infer<typeof clientHealthSchema>;

export const storageCommandSchema = z.object({
  kind: z.literal('storage-command'),
  requestId: identifier,
  providerId: identifier,
  operation: storageOperationSchema,
  key: z.string().max(10_000).optional(),
  value: z.string().max(1_000_000).optional(),
  cursor: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export type StorageCommand = z.infer<typeof storageCommandSchema>;

export const storageResultSchema = z.object({
  kind: z.literal('storage-result'),
  requestId: identifier,
  providerId: identifier,
  operation: storageOperationSchema,
  success: z.boolean(),
  providers: z
    .array(
      z.object({
        id: identifier,
        name: z.string().min(1).max(1_024),
        capabilities: z.object({
          paginatedKeys: z.boolean(),
          lazyValues: z.boolean(),
          mutations: z.boolean(),
          typedValues: z.boolean(),
          snapshots: z.boolean(),
        }),
      }),
    )
    .max(100)
    .optional(),
  keys: z.array(z.string().max(10_000)).max(100_000).optional(),
  keyEntries: z
    .array(
      z.object({
        key: z.string().max(10_000),
        valueSize: z.number().int().nonnegative().optional(),
        valueType: z.enum(['string', 'number', 'boolean', 'json', 'binary', 'unknown']),
        sensitive: z.boolean(),
      }),
    )
    .max(500)
    .optional(),
  nextCursor: z.string().max(100).optional(),
  totalKeys: z.number().int().nonnegative().optional(),
  value: z.string().max(1_000_000).nullable().optional(),
  valueSize: z.number().int().nonnegative().optional(),
  valueType: z.enum(['string', 'number', 'boolean', 'json', 'binary', 'unknown']).optional(),
  sensitive: z.boolean().optional(),
  redacted: z.boolean().optional(),
  error: z.string().max(10_000).optional(),
});
export type StorageResult = z.infer<typeof storageResultSchema>;

export const eventBatchSchema = z.object({
  kind: z.literal('event-batch'),
  events: z.array(eventEnvelopeSchema).min(1).max(500),
});
export type EventBatch = z.infer<typeof eventBatchSchema>;

export const serverMessageSchema = z.discriminatedUnion('kind', [
  serverHelloSchema,
  storageCommandSchema,
]);
export const clientMessageSchema = z.discriminatedUnion('kind', [
  clientHelloSchema,
  eventBatchSchema,
  storageResultSchema,
  clientHealthSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export function parseClientMessage(value: unknown) {
  return clientMessageSchema.safeParse(value);
}

export function parseServerMessage(value: unknown) {
  return serverMessageSchema.safeParse(value);
}

export function decodeJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

export function negotiateProtocolVersion(clientVersions: readonly string[]): string | undefined {
  return SUPPORTED_PROTOCOL_VERSIONS.find((version) => clientVersions.includes(version));
}
