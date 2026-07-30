import type { NetworkEventPayload } from './protocol-types.js';
import { createId } from '@pulse-rn/shared';
import {
  captureTextBody,
  captureUnknownBody,
  defaultNetworkCaptureOptions,
  normalizeHeaders,
  redactHeaders,
  sanitizeUrl,
  type NetworkCaptureOptions,
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
    const requestBody = options.captureRequestBodies
      ? captureUnknownBody(init?.body, options.maxBodyBytes, requestContentType)
      : undefined;

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
      };
      if (options.captureResponseBodies && typeof response.clone === 'function') {
        const contentType = responseHeaders['content-type'];
        void response
          .clone()
          .text()
          .then((text) => {
            const responseBody = captureTextBody(text, options.maxBodyBytes, contentType);
            emit({ ...completed, ...(responseBody ? { responseBody } : {}) });
          })
          .catch(() => emit(completed));
      } else {
        emit(completed);
      }
      return response;
    } catch (error) {
      const endedAt = Date.now();
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
        error: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }) as FetchFunction;

  return () => {
    target.fetch = original;
  };
}
