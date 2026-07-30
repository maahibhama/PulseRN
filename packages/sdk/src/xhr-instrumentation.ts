import type { NetworkEventPayload } from '@pulse-rn/protocol';
import { createId } from '@pulse-rn/shared';
import {
  captureTextBody,
  captureUnknownBody,
  defaultNetworkCaptureOptions,
  parseRawHeaders,
  redactHeaders,
  sanitizeUrl,
  type NetworkCaptureOptions,
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
  addEventListener(name: string, listener: () => void, options?: { once?: boolean }): void;
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
}

export function installXhrInterceptor(
  constructor: XMLHttpRequestConstructorLike,
  emit: (payload: NetworkEventPayload) => void,
  partialOptions: Partial<NetworkCaptureOptions> = {},
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
    const requestHeaders = redactHeaders(state.headers, options.redactedHeaders);
    if (options.captureRequestBodies) {
      state.body = captureUnknownBody(body, options.maxBodyBytes, requestHeaders['content-type']);
    }
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
          responseBody = captureTextBody(
            text,
            options.maxBodyBytes,
            responseHeaders['content-type'],
          );
        } catch {
          responseBody = undefined;
        }
      }
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
        ...(this.status === 0
          ? { error: { name: 'NetworkError', message: 'XMLHttpRequest failed' } }
          : {}),
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
