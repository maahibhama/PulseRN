import { createId } from '@pulse-rn/shared';

export interface PulseRNIdentityStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

const DEFAULT_IDENTITY_KEY = '@pulse-rn/device-id';
const DEFAULT_SESSION_KEY = '@pulse-rn/session';
const VALID_DEVICE_ID = /^[A-Za-z0-9._:-]{1,256}$/;

export async function getOrCreatePulseRNDeviceId(
  storage: PulseRNIdentityStorage,
  key = DEFAULT_IDENTITY_KEY,
): Promise<string> {
  const normalizedKey = key.trim();
  if (!normalizedKey || normalizedKey.length > 256) {
    throw new Error('PulseRN identity key must contain 1–256 characters.');
  }
  const existing = await storage.getItem(normalizedKey);
  if (existing && VALID_DEVICE_ID.test(existing)) return existing;
  const deviceId = createId('device');
  await storage.setItem(normalizedKey, deviceId);
  return deviceId;
}

export interface PulseRNSessionIdentity {
  deviceId: string;
  sessionId: string;
}

export interface PulseRNSessionOptions {
  lifecycleId: string;
  newSession?: boolean;
  deviceKey?: string;
  sessionKey?: string;
}

export async function getOrCreatePulseRNIdentity(
  storage: PulseRNIdentityStorage,
  options: PulseRNSessionOptions,
): Promise<PulseRNSessionIdentity> {
  const lifecycleId = options.lifecycleId.trim();
  if (!lifecycleId || lifecycleId.length > 256) {
    throw new Error('PulseRN lifecycleId must contain 1–256 characters.');
  }
  const sessionKey = (options.sessionKey ?? DEFAULT_SESSION_KEY).trim();
  if (!sessionKey || sessionKey.length > 256) {
    throw new Error('PulseRN session key must contain 1–256 characters.');
  }
  const deviceId = await getOrCreatePulseRNDeviceId(
    storage,
    options.deviceKey ?? DEFAULT_IDENTITY_KEY,
  );
  let stored: { lifecycleId: string; sessionId: string } | undefined;
  try {
    const value = await storage.getItem(sessionKey);
    if (value) stored = JSON.parse(value) as typeof stored;
  } catch {
    stored = undefined;
  }
  const storedSessionId = stored?.sessionId;
  const reuse =
    !options.newSession &&
    stored?.lifecycleId === lifecycleId &&
    typeof storedSessionId === 'string' &&
    VALID_DEVICE_ID.test(storedSessionId);
  const sessionId = reuse && storedSessionId ? storedSessionId : createId('session');
  if (!reuse) await storage.setItem(sessionKey, JSON.stringify({ lifecycleId, sessionId }));
  return { deviceId, sessionId };
}
