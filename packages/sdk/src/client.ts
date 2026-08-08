import { PROTOCOL_VERSION, parseServerMessage } from '@pulse-rn/protocol';
import { createId, redact } from '@pulse-rn/shared';
import type {
  ClientHealth,
  ClientHello,
  DevToolEventEnvelope,
  EventBatch,
  ErrorContextEvent,
  ErrorEventPayload,
  JsonValue,
  NetworkEventPayload,
  NetworkLifecycleEventPayload,
  PerformanceEventPayload,
  StorageCommand,
  StorageEventPayload,
  StorageResult,
} from './protocol-types.js';
import { installAxiosInterceptor, type AxiosInstanceLike } from './axios-instrumentation';
import { installConsoleInterceptor } from './console-instrumentation';
import { installFetchInterceptor } from './fetch-instrumentation';
import type { NetworkCaptureOptions } from './network-utils';
import { formatConsoleMessage } from './serialization';
import { installXhrInterceptor } from './xhr-instrumentation';
import {
  installErrorInterceptor,
  toCapturedError,
  type CapturedError,
} from './error-instrumentation';
import { PerformanceMonitor } from './performance-monitor';
import type { StorageProvider } from './storage-provider';
import type {
  CaptureErrorOptions,
  ClientConnectionState,
  ClientDiagnosticSummary,
  ClientDiagnostics,
  DevToolConfig,
  DroppedEventReason,
  TrackEventInput,
  WebSocketFactory,
  WebSocketLike,
} from './types.js';
import { pulseRNEventCategories, validatePulseRNConfig } from './configuration.js';

const SDK_VERSION = '1.0.5';
const CONNECTING = 0;
const OPEN = 1;
type RegisteredStorageProvider = StorageProvider & {
  capabilities: NonNullable<StorageProvider['capabilities']>;
};

function boundedNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('PulseRN requires a WebSocket implementation in this runtime.');
  }
  return new globalThis.WebSocket(url) as unknown as WebSocketLike;
}

export class DevToolClient {
  private readonly config: Required<
    Pick<
      DevToolConfig,
      | 'host'
      | 'port'
      | 'secure'
      | 'batchSize'
      | 'batchIntervalMs'
      | 'maxQueueSize'
      | 'maxPayloadBytes'
      | 'reconnect'
      | 'reconnectBaseDelayMs'
      | 'reconnectMaxDelayMs'
      | 'diagnosticsIntervalMs'
      | 'maxSocketBufferBytes'
    >
  > &
    DevToolConfig;
  private readonly factory: WebSocketFactory;
  private socket?: WebSocketLike;
  private queue: DevToolEventEnvelope[] = [];
  private sequence = 0;
  private reconnectAttempt = 0;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private diagnosticsTimer?: ReturnType<typeof setInterval>;
  private negotiated = false;
  private supportsClientHealth = false;
  private manuallyClosed = false;
  private droppedEvents = 0;
  private oversizedEvents = 0;
  private queueOverflowEvents = 0;
  private consoleDroppedEvents = 0;
  private consoleCaptureTimes: number[] = [];
  private networkCapturedBytes = 0;
  private sentEvents = 0;
  private sentBatches = 0;
  private reconnectAttempts = 0;
  private clockOffsetMs = 0;
  private pairingCode?: string;
  private reconnectToken?: string;
  private lastEventAt?: number;
  private connectionState: ClientConnectionState = 'idle';
  private readonly connectionListeners = new Set<(state: ClientConnectionState) => void>();
  private readonly samplingCounts = new Map<DevToolEventEnvelope['category'], number>();
  private restoreConsole?: () => void;
  private restoreErrors?: () => void;
  private networkRestores: (() => void)[] = [];
  private recentEvents: ErrorContextEvent[] = [];
  private currentScreen?: string;
  private readonly storageProviders = new Map<string, RegisteredStorageProvider>();
  private readonly storageBackups = new Map<
    string,
    { providerId: string; key: string; value: string | null }
  >();
  readonly performance: PerformanceMonitor;
  readonly deviceId: string;
  readonly sessionId: string;
  readonly appId: string;

  constructor(config: DevToolConfig, factory: WebSocketFactory = defaultWebSocketFactory) {
    validatePulseRNConfig(config);
    this.config = {
      host: '127.0.0.1',
      port: 9090,
      secure: false,
      batchSize: 50,
      batchIntervalMs: 100,
      maxQueueSize: 5_000,
      maxPayloadBytes: 256 * 1024,
      reconnect: true,
      reconnectBaseDelayMs: 500,
      reconnectMaxDelayMs: 30_000,
      ...config,
      diagnosticsIntervalMs: boundedNumber(config.diagnosticsIntervalMs, 2_000, 250, 60_000),
      maxSocketBufferBytes: boundedNumber(
        config.maxSocketBufferBytes,
        1024 * 1024,
        16 * 1024,
        64 * 1024 * 1024,
      ),
      maxConsoleEventsPerMinute: boundedNumber(config.maxConsoleEventsPerMinute, 6_000, 1, 100_000),
      maxNetworkBodyBytes: boundedNumber(
        config.maxNetworkBodyBytes,
        100 * 1024,
        0,
        16 * 1024 * 1024,
      ),
      maxNetworkRequestBytes: boundedNumber(
        config.maxNetworkRequestBytes,
        256 * 1024,
        1_024,
        16 * 1024 * 1024,
      ),
      maxNetworkSessionBytes: boundedNumber(
        config.maxNetworkSessionBytes,
        10 * 1024 * 1024,
        1_024,
        512 * 1024 * 1024,
      ),
    };
    this.factory = factory;
    this.pairingCode = config.pairingCode;
    this.reconnectToken = config.reconnectToken;
    this.deviceId = config.deviceId ?? createId('device');
    this.sessionId = config.sessionId ?? createId('session');
    this.appId = config.appId ?? config.appName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    this.performance = new PerformanceMonitor(
      (payload: PerformanceEventPayload) =>
        this.track({ category: 'performance', type: `performance.${payload.metric}`, payload }),
      {
        sampleIntervalMs: config.performanceSampleIntervalMs,
        stallThresholdMs: config.javascriptStallThresholdMs,
        captureMemory: config.captureMemory,
      },
    );
  }

  connect(): this {
    const isDevelopment =
      this.config.isDevelopment ??
      (this.config.environment
        ? this.config.environment !== 'production'
        : typeof __DEV__ === 'boolean'
          ? __DEV__
          : true);
    if (!isDevelopment && !this.config.allowInProduction) {
      this.setConnectionState('disconnected');
      return this;
    }
    if (this.socket?.readyState === CONNECTING || this.socket?.readyState === OPEN) return this;

    this.manuallyClosed = false;
    this.setConnectionState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    if (this.config.enablePerformance) this.performance.start();
    if (this.config.enableConsole && !this.restoreConsole) {
      this.restoreConsole = installConsoleInterceptor(
        console,
        (level, payload) => {
          const now = Date.now();
          this.consoleCaptureTimes = this.consoleCaptureTimes.filter(
            (capturedAt) => now - capturedAt < 60_000,
          );
          if (this.consoleCaptureTimes.length >= (this.config.maxConsoleEventsPerMinute ?? 6_000)) {
            this.droppedEvents += 1;
            this.consoleDroppedEvents += 1;
            this.config.onDroppedEvent?.({
              reason: 'console-rate-limit',
              category: 'console',
              type: `console.${level}`,
              totalDroppedEvents: this.droppedEvents,
            });
            this.reportDiagnostics();
            return;
          }
          this.consoleCaptureTimes.push(now);
          this.track({
            category: 'console',
            type: `console.${level}`,
            payload,
          });
        },
        {
          captureStackTrace: this.config.captureConsoleStackTrace ?? true,
          serialization: this.config.consoleSerialization,
        },
      );
    }
    if (this.config.enableErrors && !this.restoreErrors) {
      this.restoreErrors = installErrorInterceptor(
        globalThis as Parameters<typeof installErrorInterceptor>[0],
        (error) => this.emitError(error),
      );
    }
    if (this.config.enableNetwork && this.networkRestores.length === 0) {
      const emit = (payload: NetworkEventPayload) => {
        this.track({
          category: 'network',
          type: 'network.request',
          payload,
          correlationId: payload.requestId,
        });
      };
      const emitLifecycle = (type: string, payload: NetworkLifecycleEventPayload) => {
        this.track({
          category: 'network',
          type,
          payload,
          correlationId: payload.requestId,
        });
      };
      if (typeof globalThis.fetch === 'function') {
        this.networkRestores.push(
          installFetchInterceptor(globalThis, emit, this.networkOptions(), emitLifecycle),
        );
      }
      const xhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
      if (typeof xhr === 'function') {
        this.networkRestores.push(
          installXhrInterceptor(
            xhr as Parameters<typeof installXhrInterceptor>[0],
            emit,
            this.networkOptions(),
            emitLifecycle,
          ),
        );
      }
    }
    const scheme = this.config.secure ? 'wss' : 'ws';
    try {
      this.socket = this.factory(`${scheme}://${this.config.host}:${this.config.port}`);
    } catch (error) {
      this.emitError(toCapturedError(error, 'sdk_internal', { classification: 'connection' }));
      this.handleClose();
      return this;
    }
    this.socket.onopen = () => this.sendHello();
    this.socket.onmessage = (event) => this.handleServerMessage(event.data);
    this.socket.onclose = () => this.handleClose();
    this.socket.onerror = () => {
      this.emitError(
        toCapturedError(new Error('PulseRN WebSocket connection error.'), 'sdk_internal', {
          classification: 'connection',
        }),
      );
    };
    return this;
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.negotiated = false;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.diagnosticsTimer) clearInterval(this.diagnosticsTimer);
    this.diagnosticsTimer = undefined;
    this.supportsClientHealth = false;
    this.restoreConsole?.();
    this.restoreConsole = undefined;
    this.restoreErrors?.();
    this.restoreErrors = undefined;
    this.performance.stop();
    for (const restore of this.networkRestores.splice(0)) restore();
    this.storageBackups.clear();
    this.socket?.close();
    this.socket = undefined;
    this.setConnectionState('disconnected');
  }

  track(input: TrackEventInput): void {
    if (this.config.categories?.[input.category] === false) {
      this.drop(input, 'category-disabled');
      return;
    }
    const samplingRate = this.config.sampling?.[input.category] ?? 1;
    if (samplingRate < 1) {
      const count = (this.samplingCounts.get(input.category) ?? 0) + 1;
      this.samplingCounts.set(input.category, count);
      const interval = samplingRate <= 0 ? Number.POSITIVE_INFINITY : Math.ceil(1 / samplingRate);
      if (count % interval !== 1 % interval) {
        this.drop(input, 'sampled');
        return;
      }
    }
    const originalConsolePayload =
      input.category === 'console' ? JSON.stringify(input.payload) : undefined;
    let payload = redact(input.payload, { fields: this.config.redaction?.fields }) as JsonValue;
    if (
      input.category === 'console' &&
      payload !== null &&
      !Array.isArray(payload) &&
      typeof payload === 'object' &&
      Array.isArray(payload['arguments'])
    ) {
      payload = {
        ...payload,
        message: formatConsoleMessage(payload['arguments']),
        ...(originalConsolePayload !== JSON.stringify(payload) ? { redacted: true } : {}),
      };
    }
    if (
      new TextEncoder().encode(JSON.stringify(payload)).byteLength > this.config.maxPayloadBytes
    ) {
      this.droppedEvents += 1;
      this.oversizedEvents += 1;
      this.notifyDrop(input, 'payload-limit');
      this.reportDiagnostics();
      return;
    }
    if (
      input.category === 'navigation' &&
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload)
    ) {
      const route = payload['currentRoute'];
      if (
        route &&
        typeof route === 'object' &&
        !Array.isArray(route) &&
        typeof route['name'] === 'string'
      ) {
        this.currentScreen = route['name'];
      }
    }
    if (
      input.category === 'error' &&
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload)
    ) {
      payload = {
        ...payload,
        context: this.recentEvents.slice(-20),
        ...(this.currentScreen ? { screen: this.currentScreen } : {}),
      };
    }
    const event: DevToolEventEnvelope = {
      id: createId('event'),
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      deviceId: this.deviceId,
      appId: this.appId,
      timestamp: Date.now(),
      sequence: this.sequence++,
      category: input.category,
      type: input.type,
      payload,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
    };
    if (this.queue.length >= this.config.maxQueueSize) {
      this.queue.shift();
      this.droppedEvents += 1;
      this.queueOverflowEvents += 1;
      this.notifyDrop(input, 'queue-overflow');
    }
    this.queue.push(event);
    this.lastEventAt = event.timestamp;
    this.rememberEvent(event);
    if (
      input.category === 'network' &&
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      payload['error'] &&
      typeof payload['error'] === 'object' &&
      !Array.isArray(payload['error'])
    ) {
      const networkError = payload['error'];
      this.emitError({
        source: 'network',
        name: typeof networkError['name'] === 'string' ? networkError['name'] : 'NetworkError',
        message:
          typeof networkError['message'] === 'string'
            ? networkError['message']
            : 'Network request failed.',
        fatal: false,
        metadata: {
          requestId: typeof payload['requestId'] === 'string' ? payload['requestId'] : '',
          method: typeof payload['method'] === 'string' ? payload['method'] : '',
          url: typeof payload['url'] === 'string' ? payload['url'] : '',
        },
      });
    }
    if (input.category === 'error' || this.queue.length >= this.config.batchSize) this.flush();
    else this.scheduleFlush();
  }

  captureError(error: unknown, options: CaptureErrorOptions = {}): void {
    this.emitError(
      toCapturedError(error, options.source ?? 'manual', {
        ...(options.fatal === undefined ? {} : { fatal: options.fatal }),
        ...(options.componentStack ? { componentStack: options.componentStack } : {}),
        ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
      }),
    );
  }

  getStats(): ClientDiagnostics {
    return {
      connectionState: this.connectionState,
      queuedEvents: this.queue.length,
      droppedEvents: this.droppedEvents,
      connected: this.negotiated,
      oversizedEvents: this.oversizedEvents,
      queueOverflowEvents: this.queueOverflowEvents,
      consoleDroppedEvents: this.consoleDroppedEvents,
      sentEvents: this.sentEvents,
      sentBatches: this.sentBatches,
      reconnectAttempts: this.reconnectAttempts,
      socketBufferedBytes: this.socket?.bufferedAmount ?? 0,
      clockOffsetMs: this.clockOffsetMs,
      ...(this.lastEventAt === undefined ? {} : { lastEventAt: this.lastEventAt }),
    };
  }

  getDiagnosticSummary(): ClientDiagnosticSummary {
    return {
      ...this.getStats(),
      appId: this.appId,
      deviceId: this.deviceId,
      sessionId: this.sessionId,
      environment:
        this.config.environment ??
        ((this.config.isDevelopment ?? true) ? 'development' : 'production'),
      enabledCategories: pulseRNEventCategories.filter(
        (category) => this.config.categories?.[category] !== false,
      ),
    };
  }

  subscribeConnectionState(listener: (state: ClientConnectionState) => void): () => void {
    this.connectionListeners.add(listener);
    listener(this.connectionState);
    return () => this.connectionListeners.delete(listener);
  }

  attachAxios(instance: AxiosInstanceLike): () => void {
    return installAxiosInterceptor(
      instance,
      (payload) =>
        this.track({
          category: 'network',
          type: 'network.request',
          payload,
          correlationId: payload.requestId,
        }),
      this.networkOptions(),
      (type, payload) =>
        this.track({
          category: 'network',
          type,
          payload,
          correlationId: payload.requestId,
        }),
    );
  }

  registerStorageProvider(provider: StorageProvider): () => void {
    if (!provider.id.trim()) throw new Error('Storage provider ID must not be empty.');
    const registered: RegisteredStorageProvider = {
      ...provider,
      capabilities: provider.capabilities ?? {
        paginatedKeys: false,
        lazyValues: false,
        mutations: true,
        typedValues: false,
        snapshots: false,
      },
    };
    this.storageProviders.set(provider.id, registered);
    return () => {
      if (this.storageProviders.get(provider.id) === registered)
        this.storageProviders.delete(provider.id);
    };
  }

  private networkOptions(): Partial<NetworkCaptureOptions> {
    return {
      captureRequestBodies: this.config.captureRequestBodies ?? true,
      captureResponseBodies: this.config.captureResponseBodies ?? true,
      maxBodyBytes: this.config.maxNetworkBodyBytes ?? 100 * 1024,
      maxRequestBytes: this.config.maxNetworkRequestBytes ?? 256 * 1024,
      maxSessionBytes: this.config.maxNetworkSessionBytes ?? 10 * 1024 * 1024,
      reserveCapture: (bytes) => {
        const limit = this.config.maxNetworkSessionBytes ?? 10 * 1024 * 1024;
        if (this.networkCapturedBytes + bytes > limit) return false;
        this.networkCapturedBytes += bytes;
        return true;
      },
      redactedHeaders: this.config.redaction?.headers ?? [],
      redactedQueryParameters: [
        ...(this.config.redaction?.fields ?? []),
        ...(this.config.redaction?.queryParameters ?? []),
      ],
    };
  }

  private emitError(error: CapturedError): void {
    if (!this.config.enableErrors) return;
    const latest = (category: DevToolEventEnvelope['category']) =>
      [...this.recentEvents].reverse().find((event) => event.category === category);
    const metadata =
      error.metadata && typeof error.metadata === 'object' && !Array.isArray(error.metadata)
        ? error.metadata
        : undefined;
    const correlations = {
      ...(this.currentScreen ? { route: this.currentScreen } : {}),
      ...(typeof metadata?.['requestId'] === 'string' && metadata['requestId']
        ? { requestId: metadata['requestId'] }
        : {}),
      ...(latest('redux') ? { reduxEventId: latest('redux')!.id } : {}),
      ...(latest('console') ? { consoleEventId: latest('console')!.id } : {}),
      ...(latest('performance') ? { performanceEventId: latest('performance')!.id } : {}),
    };
    const payload: ErrorEventPayload = {
      ...error,
      context: [],
      ...(this.config.appVersion ? { appVersion: this.config.appVersion } : {}),
      ...(Object.keys(correlations).length > 0 ? { correlations } : {}),
    };
    this.track({ category: 'error', type: `error.${error.source}`, payload });
  }

  private rememberEvent(event: DevToolEventEnvelope): void {
    let summary: string | undefined;
    if (event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)) {
      const candidate =
        event.payload['message'] ??
        event.payload['actionType'] ??
        event.payload['url'] ??
        event.payload['name'];
      if (typeof candidate === 'string') summary = candidate.slice(0, 10_000);
    }
    this.recentEvents.push({
      id: event.id,
      timestamp: event.timestamp,
      sequence: event.sequence,
      category: event.category,
      type: event.type,
      ...(summary ? { summary } : {}),
      ...(event.correlationId ? { correlationId: event.correlationId } : {}),
    });
    if (this.recentEvents.length > 20) this.recentEvents.shift();
  }

  private sendHello(): void {
    const message: ClientHello = {
      kind: 'client-hello',
      supportedProtocolVersions: [PROTOCOL_VERSION],
      sessionId: this.sessionId,
      deviceId: this.deviceId,
      appId: this.appId,
      device: {
        name: this.config.device?.name ?? 'React Native device',
        platform: this.config.device?.platform ?? 'unknown',
        ...(this.config.device?.platformVersion
          ? { platformVersion: this.config.device.platformVersion }
          : {}),
        ...(this.config.device?.model ? { model: this.config.device.model } : {}),
        ...(this.config.device?.nativeTargetId
          ? { nativeTargetId: this.config.device.nativeTargetId }
          : {}),
        appName: this.config.appName,
        ...(this.config.appVersion ? { appVersion: this.config.appVersion } : {}),
        sdkVersion: SDK_VERSION,
      },
      ...(this.config.authToken ? { authToken: this.config.authToken } : {}),
      ...(this.pairingCode ? { pairingCode: this.pairingCode } : {}),
      ...(this.reconnectToken ? { reconnectToken: this.reconnectToken } : {}),
    };
    this.socket?.send(JSON.stringify(message));
  }

  private handleServerMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    try {
      const result = parseServerMessage(JSON.parse(data) as unknown);
      if (!result.success) return;
      if (result.data.kind === 'storage-command') {
        if (this.negotiated) void this.handleStorageCommand(result.data);
        return;
      }
      if (!result.data.accepted) {
        this.disconnect();
        return;
      }
      this.negotiated = true;
      this.setConnectionState('connected');
      if (result.data.reconnectToken) {
        this.reconnectToken = result.data.reconnectToken;
        this.pairingCode = undefined;
        this.config.onReconnectToken?.(result.data.reconnectToken);
      }
      this.supportsClientHealth = result.data.capabilities?.includes('client-health') ?? false;
      this.clockOffsetMs = result.data.serverTime - Date.now();
      this.reconnectAttempt = 0;
      this.startDiagnostics();
      this.flush();
    } catch {
      // The SDK ignores malformed server input and never forwards it to the app.
    }
  }

  private async handleStorageCommand(command: StorageCommand): Promise<void> {
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    let response: StorageResult;
    try {
      if (!this.config.enableStorage) throw new Error('Storage inspection is disabled.');
      if (command.operation === 'providers') {
        response = {
          kind: 'storage-result',
          requestId: command.requestId,
          providerId: command.providerId,
          operation: command.operation,
          success: true,
          providers: [...this.storageProviders.values()].map(({ id, name, capabilities }) => ({
            id,
            name,
            capabilities,
          })),
        };
      } else {
        const provider = this.storageProviders.get(command.providerId);
        if (!provider) throw new Error(`Unknown storage provider: ${command.providerId}`);
        if (command.operation === 'list') {
          const keys = [...(await provider.getAllKeys())].sort();
          const offset = Math.max(0, Number(command.cursor ?? 0) || 0);
          const limit = Math.min(command.limit ?? 100, 500);
          const page = keys.slice(offset, offset + limit);
          response = {
            kind: 'storage-result',
            requestId: command.requestId,
            providerId: command.providerId,
            operation: command.operation,
            success: true,
            keys: page,
            keyEntries: page.map((key) => ({
              key,
              valueType: 'unknown',
              sensitive: false,
            })),
            totalKeys: keys.length,
            ...(offset + page.length < keys.length
              ? { nextCursor: String(offset + page.length) }
              : {}),
          };
        } else if (command.operation === 'get') {
          if (command.key === undefined) throw new Error('A key is required.');
          const rawValue = await provider.getItem(command.key);
          const value = this.sanitizeStorageValue(rawValue);
          const description = provider.describeItem?.(command.key, rawValue) ?? {
            valueType: 'unknown' as const,
          };
          response = {
            kind: 'storage-result',
            requestId: command.requestId,
            providerId: command.providerId,
            operation: command.operation,
            success: true,
            value,
            valueSize: rawValue === null ? 0 : new TextEncoder().encode(rawValue).byteLength,
            valueType: description.valueType,
            sensitive: description.sensitive ?? false,
            redacted: value?.includes('[REDACTED]') ?? false,
          };
        } else if (command.operation === 'set') {
          if (command.key === undefined || command.value === undefined)
            throw new Error('A key and value are required.');
          if (!provider.capabilities.mutations)
            throw new Error(`${provider.name} does not support mutations.`);
          const backupId = await this.backupStorageValue(provider, command.key);
          await provider.setItem(command.key, command.value);
          response = {
            kind: 'storage-result',
            requestId: command.requestId,
            providerId: command.providerId,
            operation: command.operation,
            success: true,
            backupId,
          };
        } else if (command.operation === 'delete') {
          if (command.key === undefined) throw new Error('A key is required.');
          if (!provider.capabilities.mutations)
            throw new Error(`${provider.name} does not support mutations.`);
          const backupId = await this.backupStorageValue(provider, command.key);
          await provider.removeItem(command.key);
          response = {
            kind: 'storage-result',
            requestId: command.requestId,
            providerId: command.providerId,
            operation: command.operation,
            success: true,
            backupId,
          };
        } else {
          if (!provider.capabilities.mutations)
            throw new Error(`${provider.name} does not support mutations.`);
          if (command.backupId === undefined) throw new Error('A backup ID is required.');
          const backup = this.storageBackups.get(command.backupId);
          if (
            !backup ||
            backup.providerId !== command.providerId ||
            (command.key !== undefined && backup.key !== command.key)
          ) {
            throw new Error('The storage backup is unavailable or belongs to another provider.');
          }
          if (backup.value === null) await provider.removeItem(backup.key);
          else await provider.setItem(backup.key, backup.value);
          this.storageBackups.delete(command.backupId);
          response = {
            kind: 'storage-result',
            requestId: command.requestId,
            providerId: command.providerId,
            operation: command.operation,
            success: true,
          };
        }
      }
    } catch (error) {
      response = {
        kind: 'storage-result',
        requestId: command.requestId,
        providerId: command.providerId,
        operation: command.operation,
        success: false,
        error: error instanceof Error ? error.message : 'Storage operation failed.',
      };
    }
    this.socket?.send(JSON.stringify(response));
    const payload: StorageEventPayload = {
      requestId: command.requestId,
      providerId: command.providerId,
      operation: command.operation,
      ...(command.key === undefined ? {} : { key: command.key }),
      success: response.success,
      mutation: ['set', 'delete', 'restore'].includes(command.operation),
      duration: Math.max(0, (globalThis.performance?.now?.() ?? Date.now()) - startedAt),
      ...(response.error ? { error: response.error } : {}),
    };
    this.track({ category: 'storage', type: `storage.${command.operation}`, payload });
  }

  private async backupStorageValue(
    provider: RegisteredStorageProvider,
    key: string,
  ): Promise<string> {
    const backupId = createId('storage-backup');
    this.storageBackups.set(backupId, {
      providerId: provider.id,
      key,
      value: await provider.getItem(key),
    });
    while (this.storageBackups.size > 100) {
      const oldest = this.storageBackups.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.storageBackups.delete(oldest);
    }
    return backupId;
  }

  private sanitizeStorageValue(value: string | null): string | null {
    if (value === null) return null;
    try {
      const parsed = JSON.parse(value) as unknown;
      return JSON.stringify(redact(parsed, { fields: this.config.redaction?.fields }), null, 2);
    } catch {
      return value;
    }
  }

  private flush = (): void => {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    if (!this.negotiated || this.socket?.readyState !== OPEN || this.queue.length === 0) return;
    if ((this.socket.bufferedAmount ?? 0) > this.config.maxSocketBufferBytes) {
      this.reportDiagnostics();
      this.scheduleFlush();
      return;
    }
    const message: EventBatch = {
      kind: 'event-batch',
      events: this.queue.slice(0, this.config.batchSize),
    };
    try {
      this.socket.send(JSON.stringify(message));
      this.queue.splice(0, message.events.length);
      this.sentEvents += message.events.length;
      this.sentBatches += 1;
    } catch {
      this.handleClose();
      return;
    }
    if (this.queue.length > 0) this.scheduleFlush();
  };

  private scheduleFlush(): void {
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(this.flush, this.config.batchIntervalMs);
    }
  }

  private handleClose(): void {
    this.negotiated = false;
    this.supportsClientHealth = false;
    if (this.diagnosticsTimer) clearInterval(this.diagnosticsTimer);
    this.diagnosticsTimer = undefined;
    this.socket = undefined;
    if (this.manuallyClosed || !this.config.reconnect) {
      this.setConnectionState('disconnected');
      return;
    }
    this.setConnectionState('reconnecting');
    this.reconnectAttempts += 1;
    const delay = Math.min(
      this.config.reconnectBaseDelayMs * 2 ** this.reconnectAttempt++,
      this.config.reconnectMaxDelayMs,
    );
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private startDiagnostics(): void {
    if (this.diagnosticsTimer) clearInterval(this.diagnosticsTimer);
    this.reportDiagnostics();
    this.diagnosticsTimer = setInterval(
      () => this.reportDiagnostics(),
      this.config.diagnosticsIntervalMs,
    );
  }

  private reportDiagnostics(): void {
    const diagnostics = this.getStats();
    this.config.onDiagnostics?.(diagnostics);
    if (!this.negotiated || !this.supportsClientHealth || this.socket?.readyState !== OPEN) return;
    const message: ClientHealth = {
      kind: 'client-health',
      sentAt: Date.now(),
      queuedEvents: diagnostics.queuedEvents,
      droppedEvents: diagnostics.droppedEvents,
      oversizedEvents: diagnostics.oversizedEvents,
      queueOverflowEvents: diagnostics.queueOverflowEvents,
      consoleDroppedEvents: diagnostics.consoleDroppedEvents,
      sentEvents: diagnostics.sentEvents,
      sentBatches: diagnostics.sentBatches,
      reconnectAttempts: diagnostics.reconnectAttempts,
      socketBufferedBytes: diagnostics.socketBufferedBytes,
      clockOffsetMs: diagnostics.clockOffsetMs,
      ...(diagnostics.lastEventAt === undefined ? {} : { lastEventAt: diagnostics.lastEventAt }),
    };
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      this.handleClose();
    }
  }

  private setConnectionState(state: ClientConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.config.onConnectionStateChange?.(state);
    for (const listener of this.connectionListeners) listener(state);
  }

  private drop(input: TrackEventInput, reason: DroppedEventReason): void {
    this.droppedEvents += 1;
    this.notifyDrop(input, reason);
    this.reportDiagnostics();
  }

  private notifyDrop(input: TrackEventInput, reason: DroppedEventReason): void {
    this.config.onDroppedEvent?.({
      reason,
      category: input.category,
      type: input.type,
      totalDroppedEvents: this.droppedEvents,
    });
  }
}

declare const __DEV__: boolean | undefined;
