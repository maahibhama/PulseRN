import type { JsonValue, NetworkEventPayload } from '@pulse-rn/protocol';
import { serializeConsoleValue } from './serialization';

const DEFAULT_SENSITIVE_KEYS = [
  'password',
  'otp',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'set-cookie',
  'secret',
  'apiKey',
  'creditCard',
  'cvv',
  'ssn',
];

export interface NetworkCaptureOptions {
  captureRequestBodies: boolean;
  captureResponseBodies: boolean;
  maxBodyBytes: number;
  redactedHeaders: readonly string[];
  redactedQueryParameters: readonly string[];
}

export function defaultNetworkCaptureOptions(
  options: Partial<NetworkCaptureOptions> = {},
): NetworkCaptureOptions {
  return {
    captureRequestBodies: true,
    captureResponseBodies: true,
    maxBodyBytes: 100 * 1024,
    redactedHeaders: ['authorization', 'cookie', 'set-cookie'],
    redactedQueryParameters: DEFAULT_SENSITIVE_KEYS,
    ...options,
  };
}

export function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value) return {};
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((entry): entry is [unknown, unknown] => Array.isArray(entry) && entry.length >= 2)
        .map(([key, item]) => [String(key).toLowerCase(), String(item)]),
    );
  }
  if (typeof (value as { forEach?: unknown }).forEach === 'function') {
    const result: Record<string, string> = {};
    (
      value as {
        forEach(callback: (item: string, key: string) => void): void;
      }
    ).forEach((item, key) => {
      result[key.toLowerCase()] = item;
    });
    return result;
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.toLowerCase(),
        Array.isArray(item) ? item.join(', ') : String(item),
      ]),
    );
  }
  return {};
}

export function redactHeaders(
  headers: Record<string, string>,
  configured: readonly string[],
): Record<string, string> {
  const sensitive = new Set(
    [...DEFAULT_SENSITIVE_KEYS, ...configured].map((key) => key.toLowerCase()),
  );
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      sensitive.has(key.toLowerCase()) ? '[REDACTED]' : value,
    ]),
  );
}

export function sanitizeUrl(
  input: string,
  configured: readonly string[],
): { url: string; query: Record<string, string | string[]> } {
  const sensitive = new Set(
    [...DEFAULT_SENSITIVE_KEYS, ...configured].map((key) => key.toLowerCase()),
  );
  try {
    const url = new URL(input);
    const query: Record<string, string | string[]> = {};
    const keys = new Set<string>();
    url.searchParams.forEach((_value, key) => keys.add(key));
    for (const key of keys) {
      const values = url.searchParams
        .getAll(key)
        .map((value) => (sensitive.has(key.toLowerCase()) ? '[REDACTED]' : value));
      query[key] = values.length === 1 ? values[0]! : values;
      if (sensitive.has(key.toLowerCase())) url.searchParams.set(key, '[REDACTED]');
    }
    return { url: url.toString(), query };
  } catch {
    return { url: input, query: {} };
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function truncateToBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  const characters = Array.from(value);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (byteLength(characters.slice(0, middle).join('')) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return characters.slice(0, low).join('');
}

function isBinaryContentType(contentType?: string): boolean {
  if (!contentType) return false;
  return /^(image|audio|video)\//i.test(contentType) || /octet-stream|zip|pdf/i.test(contentType);
}

export function captureTextBody(
  text: string,
  maxBytes: number,
  contentType?: string,
): NetworkEventPayload['responseBody'] {
  if (isBinaryContentType(contentType)) return undefined;
  const size = byteLength(text);
  let captured = text;
  let truncated = false;
  if (size > maxBytes) {
    captured = truncateToBytes(text, maxBytes);
    truncated = true;
  }
  let value: JsonValue = captured;
  if (/json/i.test(contentType ?? '')) {
    try {
      value = serializeConsoleValue(JSON.parse(captured) as unknown);
    } catch {
      value = captured;
    }
  }
  return {
    value,
    size,
    truncated,
    ...(contentType ? { contentType } : {}),
  };
}

export function captureUnknownBody(
  value: unknown,
  maxBytes: number,
  contentType?: string,
): NetworkEventPayload['requestBody'] {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return captureTextBody(value, maxBytes, contentType);
  if (
    typeof ArrayBuffer !== 'undefined' &&
    (value instanceof ArrayBuffer || ArrayBuffer.isView(value))
  ) {
    return undefined;
  }
  const constructorName = (value as { constructor?: { name?: string } }).constructor?.name;
  if (constructorName === 'Blob' || constructorName === 'FormData') return undefined;
  const serialized = serializeConsoleValue(value);
  const text = JSON.stringify(serialized);
  const size = byteLength(text);
  if (size > maxBytes) {
    return {
      value: '[Structured payload omitted: exceeds capture limit]',
      size,
      truncated: true,
      ...(contentType ? { contentType } : {}),
    };
  }
  return {
    value: serialized,
    size,
    truncated: false,
    ...(contentType ? { contentType } : {}),
  };
}

export function parseRawHeaders(raw: string): Record<string, string> {
  return Object.fromEntries(
    raw
      .trim()
      .split(/[\r\n]+/)
      .flatMap((line) => {
        const separator = line.indexOf(':');
        return separator > 0
          ? [[line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()]]
          : [];
      }),
  );
}
