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

export const eventEnvelopeSchema = z.object({
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
});
export type ClientHello = z.infer<typeof clientHelloSchema>;

export const serverHelloSchema = z.object({
  kind: z.literal('server-hello'),
  accepted: z.boolean(),
  protocolVersion: identifier.optional(),
  connectionId: identifier.optional(),
  reason: z.string().max(1024).optional(),
  serverTime: z.number().finite().nonnegative(),
});
export type ServerHello = z.infer<typeof serverHelloSchema>;

export const eventBatchSchema = z.object({
  kind: z.literal('event-batch'),
  events: z.array(eventEnvelopeSchema).min(1).max(500),
});
export type EventBatch = z.infer<typeof eventBatchSchema>;

export const serverMessageSchema = serverHelloSchema;
export const clientMessageSchema = z.discriminatedUnion('kind', [
  clientHelloSchema,
  eventBatchSchema,
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
