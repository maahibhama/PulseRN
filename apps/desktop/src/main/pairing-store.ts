import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const PAIRING_TTL_MS = 5 * 60 * 1_000;
const PAIRING_ATTEMPTS = 5;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const trustedDeviceRecordSchema = z.object({
  appId: z.string().min(1).max(256),
  deviceId: z.string().min(1).max(256),
  appName: z.string().min(1).max(256),
  deviceName: z.string().min(1).max(256),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.number().finite().nonnegative(),
  lastUsedAt: z.number().finite().nonnegative(),
  revokedAt: z.number().finite().nonnegative().optional(),
});

const pairingFileSchema = z.object({
  version: z.literal(1),
  devices: z.array(trustedDeviceRecordSchema).max(10_000),
});

interface PairingChallenge {
  hash: string;
  code: string;
  expiresAt: number;
  remainingAttempts: number;
}

export interface TrustedDevice {
  appId: string;
  deviceId: string;
  appName: string;
  deviceName: string;
  createdAt: number;
  lastUsedAt: number;
  revokedAt?: number;
  status: 'trusted' | 'revoked';
}

export interface PairingCode {
  code: string;
  expiresAt: number;
  remainingAttempts: number;
}

export type PairingAuthentication =
  | {
      accepted: true;
      trustStatus: 'paired' | 'trusted';
      reconnectToken?: string;
    }
  | {
      accepted: false;
      reason: string;
    };

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashesMatch(expected: string, value: string): boolean {
  const actual = hash(value);
  const expectedBytes = Buffer.from(expected, 'hex');
  const actualBytes = Buffer.from(actual, 'hex');
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function generateCode(): string {
  const bytes = randomBytes(8);
  const characters = Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join(
    '',
  );
  return `${characters.slice(0, 4)}-${characters.slice(4)}`;
}

export class PairingStore {
  private records: z.infer<typeof trustedDeviceRecordSchema>[];
  private challenge?: PairingChallenge;

  constructor(private readonly filePath: string) {
    this.records = this.read();
  }

  begin(now = Date.now()): PairingCode {
    const code = generateCode();
    this.challenge = {
      code,
      hash: hash(code),
      expiresAt: now + PAIRING_TTL_MS,
      remainingAttempts: PAIRING_ATTEMPTS,
    };
    return this.pairingCode(now)!;
  }

  pairingCode(now = Date.now()): PairingCode | undefined {
    if (!this.challenge || this.challenge.expiresAt <= now) {
      this.challenge = undefined;
      return undefined;
    }
    return {
      code: this.challenge.code,
      expiresAt: this.challenge.expiresAt,
      remainingAttempts: this.challenge.remainingAttempts,
    };
  }

  authenticate(
    input: {
      appId: string;
      deviceId: string;
      appName: string;
      deviceName: string;
      pairingCode?: string;
      reconnectToken?: string;
    },
    now = Date.now(),
  ): PairingAuthentication {
    if (input.reconnectToken) {
      const record = this.records.find(
        (candidate) =>
          candidate.appId === input.appId &&
          candidate.deviceId === input.deviceId &&
          candidate.revokedAt === undefined,
      );
      if (record && hashesMatch(record.tokenHash, input.reconnectToken)) {
        record.lastUsedAt = now;
        record.appName = input.appName;
        record.deviceName = input.deviceName;
        this.write();
        return { accepted: true, trustStatus: 'trusted' };
      }
    }

    const challenge = this.challenge;
    if (!challenge || challenge.expiresAt <= now) {
      this.challenge = undefined;
      return { accepted: false, reason: 'Pairing is required. Generate a new pairing code.' };
    }
    if (!input.pairingCode || !hashesMatch(challenge.hash, input.pairingCode.toUpperCase())) {
      challenge.remainingAttempts -= 1;
      if (challenge.remainingAttempts <= 0) this.challenge = undefined;
      return { accepted: false, reason: 'Invalid or expired pairing code.' };
    }

    this.challenge = undefined;
    const reconnectToken = randomBytes(32).toString('base64url');
    const existing = this.records.find(
      (candidate) =>
        candidate.appId === input.appId &&
        candidate.deviceId === input.deviceId &&
        candidate.revokedAt === undefined,
    );
    if (existing) {
      existing.appName = input.appName;
      existing.deviceName = input.deviceName;
      existing.tokenHash = hash(reconnectToken);
      existing.lastUsedAt = now;
    } else {
      this.records.push({
        appId: input.appId,
        deviceId: input.deviceId,
        appName: input.appName,
        deviceName: input.deviceName,
        tokenHash: hash(reconnectToken),
        createdAt: now,
        lastUsedAt: now,
      });
    }
    this.write();
    return { accepted: true, trustStatus: 'paired', reconnectToken };
  }

  revoke(appId: string, deviceId: string, now = Date.now()): boolean {
    const record = this.records.find(
      (candidate) =>
        candidate.appId === appId &&
        candidate.deviceId === deviceId &&
        candidate.revokedAt === undefined,
    );
    if (!record) return false;
    record.revokedAt = now;
    this.write();
    return true;
  }

  list(): TrustedDevice[] {
    return [...this.records]
      .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
      .map((record) => ({
        appId: record.appId,
        deviceId: record.deviceId,
        appName: record.appName,
        deviceName: record.deviceName,
        createdAt: record.createdAt,
        lastUsedAt: record.lastUsedAt,
        ...(record.revokedAt === undefined ? {} : { revokedAt: record.revokedAt }),
        status: record.revokedAt === undefined ? ('trusted' as const) : ('revoked' as const),
      }));
  }

  private read(): z.infer<typeof trustedDeviceRecordSchema>[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return pairingFileSchema.parse(parsed).devices;
    } catch {
      return [];
    }
  }

  private write(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(
      temporary,
      `${JSON.stringify({ version: 1, devices: this.records }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    renameSync(temporary, this.filePath);
  }
}
