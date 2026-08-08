import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname } from 'node:path';
import { z } from 'zod';

export const analyticsEventNameSchema = z.enum([
  'install_started',
  'onboarding_opened',
  'demo_opened',
  'sdk_instructions_copied',
  'first_app_connected',
  'first_event_persisted',
  'native_capture_started',
  'weekly_active',
  'release_update_checked',
]);
export type AnalyticsEventName = z.infer<typeof analyticsEventNameSchema>;

const analyticsPropertiesSchema = z
  .object({
    reason: z.enum(['success', 'unavailable', 'error']).optional(),
    sdkVersion: z.string().max(64).optional(),
    reactNativeVersion: z.string().max(64).optional(),
  })
  .strict();

interface AnalyticsState {
  installationId: string;
  sent: AnalyticsEventName[];
  weeklyActiveAt?: number;
}

export interface AnalyticsClientOptions {
  statePath: string;
  version: string;
  distribution: 'desktop' | 'cli';
  enabled(): boolean;
  apiKey?: string;
  host?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export class AnalyticsClient {
  private readonly fetch: typeof globalThis.fetch;
  private readonly now: () => number;

  constructor(private readonly options: AnalyticsClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  async capture(
    name: AnalyticsEventName,
    properties: z.input<typeof analyticsPropertiesSchema> = {},
  ): Promise<boolean> {
    const event = analyticsEventNameSchema.parse(name);
    const safeProperties = analyticsPropertiesSchema.parse(properties);
    if (!this.options.enabled() || !this.options.apiKey) return false;
    const state = await this.state();
    const now = this.now();
    const once = event !== 'weekly_active' && event !== 'release_update_checked';
    if (once && state.sent.includes(event)) return false;
    if (
      event === 'weekly_active' &&
      state.weeklyActiveAt &&
      now - state.weeklyActiveAt < 604_800_000
    ) {
      return false;
    }
    const response = await this.fetch(
      `${this.options.host || 'https://us.i.posthog.com'}/capture/`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: this.options.apiKey,
          event,
          timestamp: new Date(now).toISOString(),
          properties: {
            distinct_id: state.installationId,
            appVersion: this.options.version,
            distribution: this.options.distribution,
            operatingSystem: platform(),
            architecture: arch(),
            consentVersion: 1,
            $process_person_profile: false,
            $geoip_disable: true,
            ...safeProperties,
          },
        }),
      },
    );
    if (!response.ok) return false;
    if (once) state.sent.push(event);
    if (event === 'weekly_active') state.weeklyActiveAt = now;
    await this.write(state);
    return true;
  }

  async reset(): Promise<void> {
    await rm(this.options.statePath, { force: true });
  }

  private async state(): Promise<AnalyticsState> {
    try {
      const value = JSON.parse(await readFile(this.options.statePath, 'utf8')) as unknown;
      return z
        .object({
          installationId: z.string().uuid(),
          sent: z.array(analyticsEventNameSchema),
          weeklyActiveAt: z.number().nonnegative().optional(),
        })
        .parse(value);
    } catch {
      return { installationId: randomUUID(), sent: [] };
    }
  }

  private async write(state: AnalyticsState): Promise<void> {
    await mkdir(dirname(this.options.statePath), { recursive: true });
    await writeFile(this.options.statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  }
}
