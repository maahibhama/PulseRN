import type { NetworkEventPayload, NetworkLifecycleEventPayload } from './protocol-types.js';
import { createId } from '@pulse-rn/shared';
import {
  admitNetworkBody,
  captureUnknownBody,
  defaultNetworkCaptureOptions,
  normalizeHeaders,
  redactHeaders,
  sanitizeUrl,
  type NetworkCaptureOptions,
  type NetworkRequestBudget,
} from './network-utils';

interface AxiosConfig {
  url?: string;
  baseURL?: string;
  method?: string;
  headers?: unknown;
  data?: unknown;
  params?: Record<string, unknown>;
}

interface AxiosResponse {
  config: AxiosConfig;
  status: number;
  statusText?: string;
  headers?: unknown;
  data?: unknown;
}

interface AxiosError extends Error {
  config?: AxiosConfig;
  response?: AxiosResponse;
}

interface InterceptorManager<TSuccess, TError = unknown> {
  use(
    onSuccess: (value: TSuccess) => TSuccess,
    onError?: (error: TError) => Promise<never>,
  ): number;
  eject(id: number): void;
}

export interface AxiosInstanceLike {
  interceptors: {
    request: InterceptorManager<AxiosConfig>;
    response: InterceptorManager<AxiosResponse, AxiosError>;
  };
}

interface AxiosState {
  requestId: string;
  startedAt: number;
  method: string;
  url: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  body?: NetworkEventPayload['requestBody'];
  initiator?: string;
  budget: NetworkRequestBudget;
}

function configUrl(config: AxiosConfig): string {
  const raw = `${config.baseURL ?? ''}${config.url ?? ''}`;
  if (!config.params) return raw;
  try {
    const url = new URL(raw);
    for (const [key, value] of Object.entries(config.params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export function installAxiosInterceptor(
  instance: AxiosInstanceLike,
  emit: (payload: NetworkEventPayload) => void,
  partialOptions: Partial<NetworkCaptureOptions> = {},
  emitLifecycle?: (type: string, payload: NetworkLifecycleEventPayload) => void,
): () => void {
  const options = defaultNetworkCaptureOptions(partialOptions);
  const states = new WeakMap<object, AxiosState>();
  const requestId = instance.interceptors.request.use((config) => {
    const { url, query } = sanitizeUrl(configUrl(config), options.redactedQueryParameters);
    const headers = redactHeaders(normalizeHeaders(config.headers), options.redactedHeaders);
    const requestId = createId('request');
    const startedAt = Date.now();
    const initiator = new Error().stack;
    const budget: NetworkRequestBudget = { capturedBytes: 0, omittedBodies: [] };
    states.set(config, {
      requestId,
      startedAt,
      method: (config.method ?? 'GET').toUpperCase(),
      url,
      query,
      headers,
      ...(initiator ? { initiator } : {}),
      budget,
      ...(options.captureRequestBodies
        ? {
            body: admitNetworkBody(
              captureUnknownBody(config.data, options.maxBodyBytes, headers['content-type']),
              'request',
              budget,
              options,
            ),
          }
        : {}),
    });
    emitLifecycle?.('network.request-start', {
      phase: 'start',
      requestId,
      transport: 'axios',
      method: (config.method ?? 'GET').toUpperCase(),
      url,
      timestamp: startedAt,
      startedAt,
      ...(initiator ? { initiator } : {}),
      timingAccuracy: 'measured',
    });
    return config;
  });

  const emitResponse = (response: AxiosResponse, error?: AxiosError) => {
    const state = states.get(response.config);
    if (!state) return;
    const endedAt = Date.now();
    const responseHeaders = redactHeaders(
      normalizeHeaders(response.headers),
      options.redactedHeaders,
    );
    const responseBody = admitNetworkBody(
      options.captureResponseBodies
        ? captureUnknownBody(response.data, options.maxBodyBytes, responseHeaders['content-type'])
        : undefined,
      'response',
      state.budget,
      options,
    );
    const capturedError = error ? { name: error.name, message: error.message } : undefined;
    emitLifecycle?.(capturedError ? 'network.request-failure' : 'network.request-complete', {
      phase: capturedError ? 'failure' : 'complete',
      requestId: state.requestId,
      transport: 'axios',
      method: state.method,
      url: state.url,
      timestamp: endedAt,
      startedAt: state.startedAt,
      status: response.status,
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
      transport: 'axios',
      method: state.method,
      url: state.url,
      query: state.query,
      requestHeaders: state.headers,
      ...(state.body ? { requestBody: state.body } : {}),
      status: response.status,
      statusText: response.statusText ?? '',
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

  const responseId = instance.interceptors.response.use(
    (response) => {
      emitResponse(response);
      return response;
    },
    async (error) => {
      if (error.response) {
        emitResponse(error.response, error);
      } else if (error.config) {
        const state = states.get(error.config);
        if (state) {
          const endedAt = Date.now();
          const capturedError = { name: error.name, message: error.message };
          emitLifecycle?.('network.request-failure', {
            phase: 'failure',
            requestId: state.requestId,
            transport: 'axios',
            method: state.method,
            url: state.url,
            timestamp: endedAt,
            startedAt: state.startedAt,
            ...(state.initiator ? { initiator: state.initiator } : {}),
            timingAccuracy: 'measured',
            error: capturedError,
            capture: {
              requestBudgetBytes: options.maxRequestBytes,
              sessionBudgetBytes: options.maxSessionBytes,
              omittedBodies: state.budget.omittedBodies,
            },
          });
          emit({
            requestId: state.requestId,
            transport: 'axios',
            method: state.method,
            url: state.url,
            query: state.query,
            requestHeaders: state.headers,
            ...(state.body ? { requestBody: state.body } : {}),
            startedAt: state.startedAt,
            endedAt,
            duration: endedAt - state.startedAt,
            timingAccuracy: 'measured',
            ...(state.initiator ? { initiator: state.initiator } : {}),
            error: capturedError,
            capture: {
              requestBudgetBytes: options.maxRequestBytes,
              sessionBudgetBytes: options.maxSessionBytes,
              omittedBodies: state.budget.omittedBodies,
            },
          });
        }
      }
      throw error;
    },
  );

  return () => {
    instance.interceptors.request.eject(requestId);
    instance.interceptors.response.eject(responseId);
  };
}
