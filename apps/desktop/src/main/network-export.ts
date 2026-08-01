import {
  networkEventPayloadSchema,
  type DevToolEventEnvelope,
  type NetworkEventPayload,
} from '@pulse-rn/protocol';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
]);

function safeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [
      name,
      SENSITIVE_HEADERS.has(name.toLowerCase()) ? '[REDACTED]' : value,
    ]),
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function createCurlCommand(payload: NetworkEventPayload): string {
  const parts = ['curl', '-X', payload.method, shellQuote(payload.url)];
  for (const [name, value] of Object.entries(safeHeaders(payload.requestHeaders))) {
    parts.push('-H', shellQuote(`${name}: ${value}`));
  }
  if (payload.requestBody) {
    const body =
      typeof payload.requestBody.value === 'string'
        ? payload.requestBody.value
        : JSON.stringify(payload.requestBody.value);
    parts.push('--data-raw', shellQuote(body));
  }
  return parts.join(' ');
}

export function createSanitizedHar(events: readonly DevToolEventEnvelope[]) {
  const entries = events.flatMap((event) => {
    const parsed = networkEventPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return [];
    const payload = parsed.data;
    const requestHeaders = safeHeaders(payload.requestHeaders);
    const responseHeaders = safeHeaders(payload.responseHeaders);
    return [
      {
        startedDateTime: new Date(payload.startedAt).toISOString(),
        time: payload.duration,
        request: {
          method: payload.method,
          url: payload.url,
          httpVersion: '',
          headers: Object.entries(requestHeaders).map(([name, value]) => ({ name, value })),
          queryString: Object.entries(payload.query).flatMap(([name, value]) =>
            (Array.isArray(value) ? value : [value]).map((item) => ({ name, value: item })),
          ),
          cookies: [],
          headersSize: -1,
          bodySize: payload.requestBody?.size ?? 0,
          ...(payload.requestBody
            ? {
                postData: {
                  mimeType: payload.requestBody.contentType ?? 'text/plain',
                  text:
                    typeof payload.requestBody.value === 'string'
                      ? payload.requestBody.value
                      : JSON.stringify(payload.requestBody.value),
                },
              }
            : {}),
        },
        response: {
          status: payload.status ?? 0,
          statusText: payload.statusText ?? '',
          httpVersion: '',
          headers: Object.entries(responseHeaders).map(([name, value]) => ({ name, value })),
          cookies: [],
          content: {
            size: payload.responseBody?.size ?? 0,
            mimeType: payload.responseBody?.contentType ?? '',
            ...(payload.responseBody
              ? {
                  text:
                    typeof payload.responseBody.value === 'string'
                      ? payload.responseBody.value
                      : JSON.stringify(payload.responseBody.value),
                }
              : {}),
          },
          redirectURL: payload.redirectChain?.at(-1)?.to ?? '',
          headersSize: -1,
          bodySize: payload.responseBody?.size ?? 0,
        },
        cache: {},
        timings: {
          send: 0,
          wait: payload.duration,
          receive: 0,
          comment:
            payload.timingAccuracy === 'approximate'
              ? 'React Native timing is approximate.'
              : 'Only total React Native request duration is available.',
        },
        comment: payload.capture?.omittedBodies.length
          ? `Bodies omitted by capture budget: ${payload.capture.omittedBodies.join(', ')}`
          : '',
      },
    ];
  });
  return {
    log: {
      version: '1.2',
      creator: { name: 'PulseRN', version: '0.1.2' },
      entries,
    },
  };
}
