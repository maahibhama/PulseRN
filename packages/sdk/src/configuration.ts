import type { DevToolEventCategory } from './protocol-types.js';
import type { DevToolConfig } from './types.js';

const CATEGORIES: DevToolEventCategory[] = [
  'system',
  'console',
  'network',
  'redux',
  'navigation',
  'performance',
  'animation',
  'worklet',
  'storage',
  'error',
  'device',
  'interaction',
];

function assertFiniteNumber(
  name: string,
  value: number | undefined,
  minimum: number,
  maximum: number,
): void {
  if (value !== undefined && (!Number.isFinite(value) || value < minimum || value > maximum)) {
    throw new Error(`PulseRN ${name} must be between ${minimum} and ${maximum}.`);
  }
}

export function validatePulseRNConfig(config: DevToolConfig): DevToolConfig {
  if (!config || typeof config !== 'object') throw new Error('PulseRN configuration is required.');
  if (!config.appName?.trim() || config.appName.length > 256) {
    throw new Error('PulseRN appName must contain 1–256 characters.');
  }
  if (config.host !== undefined && (!config.host.trim() || config.host.length > 255)) {
    throw new Error('PulseRN host must contain 1–255 characters.');
  }
  assertFiniteNumber('port', config.port, 1, 65_535);
  assertFiniteNumber('batchSize', config.batchSize, 1, 1_000);
  assertFiniteNumber('batchIntervalMs', config.batchIntervalMs, 1, 60_000);
  assertFiniteNumber('maxQueueSize', config.maxQueueSize, 1, 100_000);
  assertFiniteNumber('maxPayloadBytes', config.maxPayloadBytes, 1_024, 16 * 1_024 * 1_024);
  assertFiniteNumber('diagnosticsIntervalMs', config.diagnosticsIntervalMs, 250, 60_000);
  assertFiniteNumber('maxConsoleEventsPerMinute', config.maxConsoleEventsPerMinute, 1, 100_000);
  assertFiniteNumber('maxNetworkBodyBytes', config.maxNetworkBodyBytes, 0, 16 * 1_024 * 1_024);
  assertFiniteNumber(
    'maxNetworkRequestBytes',
    config.maxNetworkRequestBytes,
    1_024,
    16 * 1_024 * 1_024,
  );
  assertFiniteNumber(
    'maxNetworkSessionBytes',
    config.maxNetworkSessionBytes,
    1_024,
    512 * 1_024 * 1_024,
  );
  for (const category of CATEGORIES) {
    const rate = config.sampling?.[category];
    if (rate !== undefined && (!Number.isFinite(rate) || rate < 0 || rate > 1)) {
      throw new Error(`PulseRN sampling.${category} must be between 0 and 1.`);
    }
  }
  return config;
}

export const pulseRNEventCategories = CATEGORIES;
