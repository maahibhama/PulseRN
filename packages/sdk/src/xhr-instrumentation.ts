import type { NetworkEventPayload, NetworkLifecycleEventPayload } from './protocol-types.js';
import { createId } from '@pulse-rn/shared';
import {
  admitNetworkBody,
  captureTextBody,
  captureUnknownBody,
  defaultNetworkCaptureOptions,
  parseRawHeaders,
  redactHeaders,
  sanitizeUrl,
  type NetworkCaptureOptions,
  type NetworkRequestBudget,
} from './network-utils';

interface XMLHttpRequestLike {
  status: number;
  statusText: string;
  responseType: string;
  response: unknown;
  responseText: string;
  open(method: string, url: string | URL, ...rest: unknown[]): void;
  send(body?: unknown): void;
  setRequestHeader(name: string, value: string): void;
  addEventListener(
    name: string,
    listener: (event?: { loaded?: number; total?: number; lengthComputable?: boolean }) => void,
    options?: { once?: boolean },
  ): void;
  getAllResponseHeaders(): string;
}

interface XMLHttpRequestConstructorLike {
  prototype: XMLHttpRequestLike;
}

interface RequestState {
  requestId: string;
  method: string;
  rawUrl: string;
  headers: Record<string, string>;
  startedAt: number;
  body?: NetworkEventPayload['requestBody'];
  emitted: boolean;
  initiator?: string;
  budget: NetworkRequestBudget;
}

export function installXhrInterceptor(
  constructor: XMLHttpRequestConstructorLike,
  emit: (payload: NetworkEventPayload) => void,
  partialOptions: Partial<NetworkCaptureOptions> = {},
  emitLifecycle?: (type: string, payload: NetworkLifecycleEventPayload) => void,
): () => void {
  const options = defaultNetworkCaptureOptions(partialOptions);
  const prototype = constructor.prototype;
  const originalOpen = prototype.open;
  const originalSend = prototype.send;
  const originalSetRequestHeader = prototype.setRequestHeader;
  const states = new WeakMap<XMLHttpRequestLike, RequestState>();

  prototype.open = function (method, url, ...rest) {
    states.set(this, {
      requestId: createId('request'),
      method: method.toUpperCase(),
      rawUrl: String(url),
      headers: {},
      startedAt: 0,
      emitted: false,
      budget: { capturedBytes: 0, omittedBodies: [] },
    });
    originalOpen.call(this, method, url, ...rest);
  };

  prototype.setRequestHeader = function (name, value) {
    const state = states.get(this);
    if (state) state.headers[name.toLowerCase()] = value;
    originalSetRequestHeader.call(this, name, value);
  };

  prototype.send = function (body) {
    const state = states.get(this);
    if (!state) return originalSend.call(this, body);
    state.startedAt = Date.now();
    state.initiator = new Error().stack;
    const sanitized = sanitizeUrl(state.rawUrl, options.redactedQueryParameters);
    const requestHeaders = redactHeaders(state.headers, options.redactedHeaders);
    if (options.captureRequestBodies) {
      state.body = admitNetworkBody(
        captureUnknownBody(body, options.maxBodyBytes, requestHeaders['content-type']),
        'request',
        state.budget,
        options,
      );
    }
    emitLifecycle?.('network.request-start', {
      phase: 'start',
      requestId: state.requestId,
      transport: 'xhr',
      method: state.method,
      url: sanitized.url,
      timestamp: state.startedAt,
      startedAt: state.startedAt,
      ...(state.initiator ? { initiator: state.initiator } : {}),
      timingAccuracy: 'measured',
    });
    this.addEventListener('progress', (progress) => {
      emitLifecycle?.('network.request-progress', {
        phase: 'progress',
        requestId: state.requestId,
        transport: 'xhr',
        method: state.method,
        url: sanitized.url,
        timestamp: Date.now(),
        startedAt: state.startedAt,
        loadedBytes: progress?.loaded ?? 0,
        ...(progress?.lengthComputable && progress.total !== undefined
          ? { totalBytes: progress.total }
          : {}),
        ...(state.initiator ? { initiator: state.initiator } : {}),
        timingAccuracy: 'approximate',
      });
    });
    const finish = () => {
      if (state.emitted) return;
      state.emitted = true;
      const endedAt = Date.now();
      const { url, query } = sanitizeUrl(state.rawUrl, options.redactedQueryParameters);
      const responseHeaders = redactHeaders(
        parseRawHeaders(this.getAllResponseHeaders()),
        options.redactedHeaders,
      );
      let responseBody: NetworkEventPayload['responseBody'];
      if (
        options.captureResponseBodies &&
        (this.responseType === '' || this.responseType === 'text' || this.responseType === 'json')
      ) {
        try {
          const text =
            this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
          responseBody = admitNetworkBody(
            captureTextBody(text, options.maxBodyBytes, responseHeaders['content-type']),
            'response',
            state.budget,
            options,
          );
        } catch {
          responseBody = undefined;
        }
      }
      const failed = this.status === 0;
      const capturedError = failed
        ? { name: 'NetworkError', message: 'XMLHttpRequest failed' }
        : undefined;
      emitLifecycle?.(failed ? 'network.request-failure' : 'network.request-complete', {
        phase: failed ? 'failure' : 'complete',
        requestId: state.requestId,
        transport: 'xhr',
        method: state.method,
        url,
        timestamp: endedAt,
        startedAt: state.startedAt,
        status: this.status,
        ...(state.initiator ? { initiator: state.initiator } : {}),
        timingAccuracy: 'measured',
        ...(capturedError ? { error: capturedError } : {}),
        capture: {
          requestBudgetBytes: options.maxRequestBytes,
          sessionBudgetBytes: options.maxSessionBytes,
          omittedBodies: state.budget.omittedBodies,
        },
      });
      emit({
        requestId: state.requestId,
        transport: 'xhr',
        method: state.method,
        url,
        query,
        requestHeaders,
        ...(state.body ? { requestBody: state.body } : {}),
        status: this.status,
        statusText: this.statusText,
        responseHeaders,
        ...(responseBody ? { responseBody } : {}),
        startedAt: state.startedAt,
        endedAt,
        duration: endedAt - state.startedAt,
        timingAccuracy: 'measured',
        ...(state.initiator ? { initiator: state.initiator } : {}),
        ...(capturedError ? { error: capturedError } : {}),
        capture: {
          requestBudgetBytes: options.maxRequestBytes,
          sessionBudgetBytes: options.maxSessionBytes,
          omittedBodies: state.budget.omittedBodies,
        },
      });
    };
    this.addEventListener('loadend', finish, { once: true });
    originalSend.call(this, body);
  };

  return () => {
    prototype.open = originalOpen;
    prototype.send = originalSend;
    prototype.setRequestHeader = originalSetRequestHeader;
  };
}
