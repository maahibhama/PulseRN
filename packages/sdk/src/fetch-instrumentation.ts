import type { NetworkEventPayload, NetworkLifecycleEventPayload } from './protocol-types.js';
import { createId } from '@pulse-rn/shared';
import {
  admitNetworkBody,
  captureTextBody,
  captureUnknownBody,
  defaultNetworkCaptureOptions,
  normalizeHeaders,
  redactHeaders,
  sanitizeUrl,
  type NetworkCaptureOptions,
  type NetworkRequestBudget,
} from './network-utils';

type FetchFunction = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

export interface FetchTarget {
  fetch: FetchFunction;
}

function requestUrl(input: RequestInfo): string {
  return typeof input === 'string' ? input : input.url;
}

export function installFetchInterceptor(
  target: FetchTarget,
  emit: (payload: NetworkEventPayload) => void,
  partialOptions: Partial<NetworkCaptureOptions> = {},
  emitLifecycle?: (type: string, payload: NetworkLifecycleEventPayload) => void,
): () => void {
  const options = defaultNetworkCaptureOptions(partialOptions);
  const original = target.fetch;

  target.fetch = (async (input: RequestInfo, init?: RequestInit) => {
    const requestId = createId('request');
    const startedAt = Date.now();
    const rawUrl = requestUrl(input);
    const { url, query } = sanitizeUrl(rawUrl, options.redactedQueryParameters);
    const inputRequest = typeof input === 'string' ? undefined : input;
    const method = (init?.method ?? inputRequest?.method ?? 'GET').toUpperCase();
    const requestHeaders = redactHeaders(
      normalizeHeaders(init?.headers ?? inputRequest?.headers),
      options.redactedHeaders,
    );
    const requestContentType = requestHeaders['content-type'];
    const budget: NetworkRequestBudget = { capturedBytes: 0, omittedBodies: [] };
    const requestBody = admitNetworkBody(
      options.captureRequestBodies
        ? captureUnknownBody(init?.body, options.maxBodyBytes, requestContentType)
        : undefined,
      'request',
      budget,
      options,
    );
    const initiator = new Error().stack;
    emitLifecycle?.('network.request-start', {
      phase: 'start',
      requestId,
      transport: 'fetch',
      method,
      url,
      timestamp: startedAt,
      startedAt,
      ...(initiator ? { initiator } : {}),
      timingAccuracy: 'measured',
    });

    try {
      const response = await original.call(target, input, init);
      const endedAt = Date.now();
      const responseHeaders = redactHeaders(
        normalizeHeaders(response.headers),
        options.redactedHeaders,
      );
      const completed: NetworkEventPayload = {
        requestId,
        transport: 'fetch',
        method,
        url,
        query,
        requestHeaders,
        ...(requestBody ? { requestBody } : {}),
        status: response.status,
        statusText: response.statusText,
        responseHeaders,
        startedAt,
        endedAt,
        duration: endedAt - startedAt,
        timingAccuracy: 'measured',
        ...(initiator ? { initiator } : {}),
        ...(response.redirected && response.url && response.url !== rawUrl
          ? {
              redirectChain: [
                {
                  from: url,
                  to: sanitizeUrl(response.url, options.redactedQueryParameters).url,
                  at: endedAt,
                },
              ],
            }
          : {}),
      };
      if (completed.redirectChain?.[0]) {
        emitLifecycle?.('network.request-redirect', {
          phase: 'redirect',
          requestId,
          transport: 'fetch',
          method,
          url,
          timestamp: endedAt,
          startedAt,
          redirectFrom: completed.redirectChain[0].from,
          redirectTo: completed.redirectChain[0].to,
          ...(initiator ? { initiator } : {}),
          timingAccuracy: 'approximate',
        });
      }
      emitLifecycle?.('network.request-complete', {
        phase: 'complete',
        requestId,
        transport: 'fetch',
        method,
        url,
        timestamp: endedAt,
        startedAt,
        status: response.status,
        ...(initiator ? { initiator } : {}),
        timingAccuracy: 'measured',
      });
      if (options.captureResponseBodies && typeof response.clone === 'function') {
        const contentType = responseHeaders['content-type'];
        void response
          .clone()
          .text()
          .then((text) => {
            const responseBody = captureTextBody(text, options.maxBodyBytes, contentType);
            const admitted = admitNetworkBody(responseBody, 'response', budget, options);
            emit({
              ...completed,
              ...(admitted ? { responseBody: admitted } : {}),
              capture: {
                requestBudgetBytes: options.maxRequestBytes,
                sessionBudgetBytes: options.maxSessionBytes,
                omittedBodies: budget.omittedBodies,
              },
            });
          })
          .catch(() =>
            emit({
              ...completed,
              capture: {
                requestBudgetBytes: options.maxRequestBytes,
                sessionBudgetBytes: options.maxSessionBytes,
                omittedBodies: budget.omittedBodies,
              },
            }),
          );
      } else {
        emit({
          ...completed,
          capture: {
            requestBudgetBytes: options.maxRequestBytes,
            sessionBudgetBytes: options.maxSessionBytes,
            omittedBodies: budget.omittedBodies,
          },
        });
      }
      return response;
    } catch (error) {
      const endedAt = Date.now();
      const capturedError = {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      };
      emitLifecycle?.('network.request-failure', {
        phase: 'failure',
        requestId,
        transport: 'fetch',
        method,
        url,
        timestamp: endedAt,
        startedAt,
        ...(initiator ? { initiator } : {}),
        timingAccuracy: 'measured',
        error: capturedError,
      });
      emit({
        requestId,
        transport: 'fetch',
        method,
        url,
        query,
        requestHeaders,
        ...(requestBody ? { requestBody } : {}),
        startedAt,
        endedAt,
        duration: endedAt - startedAt,
        timingAccuracy: 'measured',
        ...(initiator ? { initiator } : {}),
        error: capturedError,
        capture: {
          requestBudgetBytes: options.maxRequestBytes,
          sessionBudgetBytes: options.maxSessionBytes,
          omittedBodies: budget.omittedBodies,
        },
      });
      throw error;
    }
  }) as FetchFunction;

  return () => {
    target.fetch = original;
  };
}
