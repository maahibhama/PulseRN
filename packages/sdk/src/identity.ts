import { createId } from '@pulse-rn/shared';

export interface PulseRNIdentityStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

const DEFAULT_IDENTITY_KEY = '@pulse-rn/device-id';
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
