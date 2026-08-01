import type { EventEmitter } from 'node:events';
import type { DesktopUpdateState } from '../update-types.js';
export type { DesktopUpdateState } from '../update-types.js';

interface UpdateInfo {
  version?: unknown;
}

interface DownloadProgress {
  percent?: unknown;
}

export interface DesktopUpdaterAdapter extends EventEmitter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

interface UpdateManagerOptions {
  enabled: boolean;
  currentVersion: string;
  disabledReason?: string;
  onState(state: DesktopUpdateState): void;
}

function versionFrom(value: UpdateInfo): string | undefined {
  return typeof value.version === 'string' && value.version.length <= 100
    ? value.version
    : undefined;
}

function errorMessage(error: unknown, fallback: string): string {
  return (error instanceof Error ? error.message : fallback).slice(0, 2_000);
}

export class UpdateManager {
  private state: DesktopUpdateState;

  constructor(
    private readonly updater: DesktopUpdaterAdapter,
    private readonly options: UpdateManagerOptions,
  ) {
    this.state = options.enabled
      ? {
          enabled: true,
          status: 'idle',
          currentVersion: options.currentVersion,
        }
      : {
          enabled: false,
          status: 'disabled',
          currentVersion: options.currentVersion,
          message: options.disabledReason ?? 'Updates are unavailable in this build.',
        };
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = options.currentVersion.includes('-');
    if (!options.enabled) return;
    updater.on('checking-for-update', () => this.update({ status: 'checking' }));
    updater.on('update-available', (info: UpdateInfo) =>
      this.update({
        status: 'available',
        availableVersion: versionFrom(info),
        progress: undefined,
        message: undefined,
      }),
    );
    updater.on('update-not-available', () =>
      this.update({
        status: 'up-to-date',
        availableVersion: undefined,
        progress: undefined,
        message: 'PulseRN is up to date.',
      }),
    );
    updater.on('download-progress', (progress: DownloadProgress) => {
      const percent =
        typeof progress.percent === 'number' && Number.isFinite(progress.percent)
          ? Math.max(0, Math.min(100, progress.percent))
          : undefined;
      this.update({ status: 'downloading', progress: percent });
    });
    updater.on('update-downloaded', (info: UpdateInfo) =>
      this.update({
        status: 'downloaded',
        availableVersion: versionFrom(info) ?? this.state.availableVersion,
        progress: 100,
        message: 'The update is ready to install.',
      }),
    );
    updater.on('update-cancelled', () =>
      this.update({ status: 'idle', progress: undefined, message: 'Update download cancelled.' }),
    );
    updater.on('error', (error: unknown) =>
      this.update({
        status: 'error',
        progress: undefined,
        message: errorMessage(error, 'Update operation failed.'),
      }),
    );
  }

  snapshot(): DesktopUpdateState {
    return { ...this.state };
  }

  async check(): Promise<DesktopUpdateState> {
    this.requireEnabled();
    this.update({ status: 'checking', progress: undefined, message: undefined });
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.update({
        status: 'error',
        message: errorMessage(error, 'Unable to check for updates.'),
      });
    }
    return this.snapshot();
  }

  async download(): Promise<DesktopUpdateState> {
    this.requireEnabled();
    if (this.state.status !== 'available') {
      throw new Error('No PulseRN update is available to download.');
    }
    this.update({ status: 'downloading', progress: 0, message: undefined });
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.update({
        status: 'available',
        progress: undefined,
        message: errorMessage(error, 'Unable to download the update.'),
      });
    }
    return this.snapshot();
  }

  install(): DesktopUpdateState {
    this.requireEnabled();
    if (this.state.status !== 'downloaded') {
      throw new Error('The PulseRN update has not finished downloading.');
    }
    this.update({ status: 'installing', message: 'Restarting PulseRN to install the update…' });
    this.updater.quitAndInstall(false, true);
    return this.snapshot();
  }

  private requireEnabled(): void {
    if (!this.state.enabled) {
      throw new Error(this.state.message ?? 'Updates are unavailable in this build.');
    }
  }

  private update(patch: Partial<DesktopUpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.options.onState(this.snapshot());
  }
}
