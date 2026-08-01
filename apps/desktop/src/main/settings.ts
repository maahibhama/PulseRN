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
  checkForUpdatesAutomatically: z.boolean(),
  launchAtLogin: z.boolean(),
  keepRunningInBackground: z.boolean(),
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
  checkForUpdatesAutomatically: true,
  launchAtLogin: false,
  keepRunningInBackground: true,
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
      return appSettingsSchema.parse({ ...defaults, ...appSettingsPatchSchema.parse(parsed) });
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
