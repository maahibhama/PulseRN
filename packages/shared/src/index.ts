export function createId(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

export interface RedactionOptions {
  fields?: readonly string[];
}

const DEFAULT_FIELDS = [
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

export function redact(
  value: unknown,
  options: RedactionOptions = {},
  seen = new WeakSet<object>(),
): unknown {
  const sensitive = new Set(
    [...DEFAULT_FIELDS, ...(options.fields ?? [])].map((key) => key.toLowerCase()),
  );

  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, options, seen));

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitive.has(key.toLowerCase()) ? '[REDACTED]' : redact(item, options, seen),
    ]),
  );
}
