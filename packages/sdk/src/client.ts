import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ClientHello,
  type DevToolEventEnvelope,
  type EventBatch,
  type JsonValue,
  type NetworkEventPayload,
  type PerformanceEventPayload,
} from '@pulse-rn/protocol';
import { createId, redact } from '@pulse-rn/shared';
import { installAxiosInterceptor, type AxiosInstanceLike } from './axios-instrumentation';
import { installConsoleInterceptor } from './console-instrumentation';
import { installFetchInterceptor } from './fetch-instrumentation';
import type { NetworkCaptureOptions } from './network-utils';
import { formatConsoleMessage } from './serialization';
import { installXhrInterceptor } from './xhr-instrumentation';
import { PerformanceMonitor } from './performance-monitor';
import type { DevToolConfig, TrackEventInput, WebSocketFactory, WebSocketLike } from './types.js';

const SDK_VERSION = '0.1.0';
const CONNECTING = 0;
const OPEN = 1;

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
  private negotiated = false;
  private manuallyClosed = false;
  private droppedEvents = 0;
  private restoreConsole?: () => void;
  private networkRestores: (() => void)[] = [];
  readonly performance: PerformanceMonitor;
  readonly deviceId: string;
  readonly sessionId: string;
  readonly appId: string;

  constructor(config: DevToolConfig, factory: WebSocketFactory = defaultWebSocketFactory) {
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
    };
    this.factory = factory;
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
      this.config.isDevelopment ?? (typeof __DEV__ === 'boolean' ? __DEV__ : true);
    if (!isDevelopment && !this.config.allowInProduction) {
      return this;
    }
    if (this.socket?.readyState === CONNECTING || this.socket?.readyState === OPEN) return this;

    this.manuallyClosed = false;
    if (this.config.enablePerformance) this.performance.start();
    if (this.config.enableConsole && !this.restoreConsole) {
      this.restoreConsole = installConsoleInterceptor(
        console,
        (level, payload) => {
          this.track({
            category: 'console',
            type: `console.${level}`,
            payload,
          });
        },
        { captureStackTrace: this.config.captureConsoleStackTrace ?? true },
      );
    }
    if (this.config.enableNetwork && this.networkRestores.length === 0) {
      const emit = (payload: NetworkEventPayload) => {
        this.track({ category: 'network', type: 'network.request', payload });
      };
      if (typeof globalThis.fetch === 'function') {
        this.networkRestores.push(installFetchInterceptor(globalThis, emit, this.networkOptions()));
      }
      const xhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
      if (typeof xhr === 'function') {
        this.networkRestores.push(
          installXhrInterceptor(
            xhr as Parameters<typeof installXhrInterceptor>[0],
            emit,
            this.networkOptions(),
          ),
        );
      }
    }
    const scheme = this.config.secure ? 'wss' : 'ws';
    this.socket = this.factory(`${scheme}://${this.config.host}:${this.config.port}`);
    this.socket.onopen = () => this.sendHello();
    this.socket.onmessage = (event) => this.handleServerMessage(event.data);
    this.socket.onclose = () => this.handleClose();
    this.socket.onerror = () => undefined;
    return this;
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.negotiated = false;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.restoreConsole?.();
    this.restoreConsole = undefined;
    this.performance.stop();
    for (const restore of this.networkRestores.splice(0)) restore();
    this.socket?.close();
    this.socket = undefined;
  }

  track(input: TrackEventInput): void {
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
      };
    }
    if (
      new TextEncoder().encode(JSON.stringify(payload)).byteLength > this.config.maxPayloadBytes
    ) {
      this.droppedEvents += 1;
      return;
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
    }
    this.queue.push(event);
    if (this.queue.length >= this.config.batchSize) this.flush();
    else this.scheduleFlush();
  }

  getStats(): { queuedEvents: number; droppedEvents: number; connected: boolean } {
    return {
      queuedEvents: this.queue.length,
      droppedEvents: this.droppedEvents,
      connected: this.negotiated,
    };
  }

  attachAxios(instance: AxiosInstanceLike): () => void {
    return installAxiosInterceptor(
      instance,
      (payload) => this.track({ category: 'network', type: 'network.request', payload }),
      this.networkOptions(),
    );
  }

  private networkOptions(): Partial<NetworkCaptureOptions> {
    return {
      captureRequestBodies: this.config.captureRequestBodies ?? true,
      captureResponseBodies: this.config.captureResponseBodies ?? true,
      maxBodyBytes: this.config.maxNetworkBodyBytes ?? 100 * 1024,
      redactedHeaders: this.config.redaction?.headers ?? [],
      redactedQueryParameters: [
        ...(this.config.redaction?.fields ?? []),
        ...(this.config.redaction?.queryParameters ?? []),
      ],
    };
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
        appName: this.config.appName,
        ...(this.config.appVersion ? { appVersion: this.config.appVersion } : {}),
        sdkVersion: SDK_VERSION,
      },
      ...(this.config.authToken ? { authToken: this.config.authToken } : {}),
    };
    this.socket?.send(JSON.stringify(message));
  }

  private handleServerMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    try {
      const result = parseServerMessage(JSON.parse(data) as unknown);
      if (!result.success || !result.data.accepted) {
        this.disconnect();
        return;
      }
      this.negotiated = true;
      this.reconnectAttempt = 0;
      this.flush();
    } catch {
      // The SDK ignores malformed server input and never forwards it to the app.
    }
  }

  private flush = (): void => {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    if (!this.negotiated || this.socket?.readyState !== OPEN || this.queue.length === 0) return;
    const message: EventBatch = {
      kind: 'event-batch',
      events: this.queue.splice(0, this.config.batchSize),
    };
    this.socket.send(JSON.stringify(message));
    if (this.queue.length > 0) this.scheduleFlush();
  };

  private scheduleFlush(): void {
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(this.flush, this.config.batchIntervalMs);
    }
  }

  private handleClose(): void {
    this.negotiated = false;
    this.socket = undefined;
    if (this.manuallyClosed || !this.config.reconnect) return;
    const delay = Math.min(
      this.config.reconnectBaseDelayMs * 2 ** this.reconnectAttempt++,
      this.config.reconnectMaxDelayMs,
    );
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

declare const __DEV__: boolean | undefined;
