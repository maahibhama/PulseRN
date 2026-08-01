import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

export const appSettingsSchema = z.object({
  theme: z.enum(['system', 'dark', 'light']),
  density: z.enum(['comfortable', 'compact']),
  timelineOrder: z.enum(['newest', 'oldest']),
  metroPort: z.number().int().min(1).max(65_535),
  devToolPort: z.number().int().min(1_024).max(65_535),
  allowLanConnections: z.boolean(),
  tlsEnabled: z.boolean(),
  eventRetentionDays: z.number().int().min(1).max(365),
  maxStoredEvents: z.number().int().min(1_000).max(1_000_000),
  consoleCaptureLimit: z.number().int().min(1).max(100_000),
  networkBodyCaptureBytes: z
    .number()
    .int()
    .min(0)
    .max(16 * 1024 * 1024),
  diagnosticsIntervalMs: z.number().int().min(250).max(60_000),
  redactionFields: z.array(z.string().trim().min(1).max(128)).max(100),
  performanceFpsThreshold: z.number().min(1).max(120),
  performanceStallThresholdMs: z.number().int().min(1).max(60_000),
  performanceScreenThresholdMs: z.number().int().min(1).max(120_000),
  performanceNetworkThresholdMs: z.number().int().min(1).max(120_000),
  performanceMemoryGrowthMb: z.number().min(1).max(10_000),
  pairingCodeLifetimeMinutes: z.number().int().min(1).max(30),
  pairingRetryLimit: z.number().int().min(1).max(20),
  updateChannel: z.enum(['stable', 'beta']),
  motion: z.enum(['system', 'reduced', 'full']),
  onboardingDismissed: z.boolean(),
  checkForUpdatesAutomatically: z.boolean(),
  launchAtLogin: z.boolean(),
  keepRunningInBackground: z.boolean(),
  mcpEnabled: z.boolean(),
  mcpAccessMode: z.enum(['read-only', 'debugger', 'full']),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;
export const appSettingsPatchSchema = appSettingsSchema.partial().strict();

const defaults: AppSettings = {
  theme: 'system',
  density: 'comfortable',
  timelineOrder: 'newest',
  metroPort: 8081,
  devToolPort: 9090,
  allowLanConnections: false,
  tlsEnabled: false,
  eventRetentionDays: 30,
  maxStoredEvents: 100_000,
  consoleCaptureLimit: 6_000,
  networkBodyCaptureBytes: 100 * 1024,
  diagnosticsIntervalMs: 2_000,
  redactionFields: ['token', 'password', 'secret', 'authorization', 'cookie'],
  performanceFpsThreshold: 50,
  performanceStallThresholdMs: 100,
  performanceScreenThresholdMs: 1_000,
  performanceNetworkThresholdMs: 500,
  performanceMemoryGrowthMb: 10,
  pairingCodeLifetimeMinutes: 5,
  pairingRetryLimit: 5,
  updateChannel: 'stable',
  motion: 'system',
  onboardingDismissed: false,
  checkForUpdatesAutomatically: true,
  launchAtLogin: false,
  keepRunningInBackground: true,
  mcpEnabled: false,
  mcpAccessMode: 'read-only',
};

export class SettingsStore {
  private settings: AppSettings;

  constructor(private readonly filePath: string) {
    this.settings = this.read();
  }

  get(): AppSettings {
    return { ...this.settings };
  }

  update(value: unknown): AppSettings {
    const patch = appSettingsPatchSchema.parse(value);
    this.settings = appSettingsSchema.parse({ ...this.settings, ...patch });
    this.write();
    return this.get();
  }

  private read(): AppSettings {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      const legacy = z.record(z.unknown()).parse(parsed);
      const migrated =
        legacy['mcpAccessMode'] === undefined
          ? {
              ...legacy,
              mcpAccessMode: legacy['mcpEnabled'] === true ? 'full' : 'read-only',
            }
          : legacy;
      return appSettingsSchema.parse({
        ...defaults,
        ...appSettingsPatchSchema.parse(migrated),
      });
    } catch {
      return { ...defaults };
    }
  }

  private write(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.settings, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporaryPath, this.filePath);
  }
}
