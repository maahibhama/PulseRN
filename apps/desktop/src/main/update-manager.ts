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
  channel?: 'stable' | 'beta';
  disabledReason?: string;
  onState(state: DesktopUpdateState): void;
}

function parseVersion(version: string): { core: number[]; prerelease: string[] } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? [],
  };
}

function compareVersions(left: string, right: string): number | undefined {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return undefined;
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  return a.prerelease.join('.').localeCompare(b.prerelease.join('.'), undefined, {
    numeric: true,
  });
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
  private channel: 'stable' | 'beta';
  private highestAcceptedVersion: string;

  constructor(
    private readonly updater: DesktopUpdaterAdapter,
    private readonly options: UpdateManagerOptions,
  ) {
    this.channel = options.channel ?? (options.currentVersion.includes('-') ? 'beta' : 'stable');
    this.highestAcceptedVersion = options.currentVersion;
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
    updater.allowPrerelease = this.channel === 'beta';
    if (!options.enabled) return;
    updater.on('checking-for-update', () => this.update({ status: 'checking' }));
    updater.on('update-available', (info: UpdateInfo) => {
      const version = versionFrom(info);
      const currentComparison = version
        ? compareVersions(version, this.options.currentVersion)
        : undefined;
      const highestComparison = version
        ? compareVersions(version, this.highestAcceptedVersion)
        : undefined;
      if (
        !version ||
        currentComparison === undefined ||
        currentComparison <= 0 ||
        highestComparison === undefined ||
        highestComparison < 0 ||
        (this.channel === 'stable' && version.includes('-'))
      ) {
        this.update({
          status: 'error',
          availableVersion: undefined,
          progress: undefined,
          message: 'Rejected update metadata with an invalid channel, version, or rollback.',
        });
        return;
      }
      this.highestAcceptedVersion = version;
      this.update({
        status: 'available',
        availableVersion: version,
        progress: undefined,
        message: undefined,
      });
    });
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
    updater.on('update-downloaded', (info: UpdateInfo) => {
      const version = versionFrom(info) ?? this.state.availableVersion;
      if (!version || version !== this.state.availableVersion) {
        this.update({
          status: 'error',
          progress: undefined,
          message: 'Downloaded update metadata does not match the approved version.',
        });
        return;
      }
      this.update({
        status: 'downloaded',
        availableVersion: version,
        progress: 100,
        message: 'The update is ready to install.',
      });
    });
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

  setChannel(channel: 'stable' | 'beta'): DesktopUpdateState {
    this.channel = channel;
    this.updater.allowPrerelease = channel === 'beta';
    if (
      channel === 'stable' &&
      this.state.availableVersion?.includes('-') &&
      ['available', 'downloading', 'downloaded'].includes(this.state.status)
    ) {
      this.update({
        status: 'idle',
        availableVersion: undefined,
        progress: undefined,
        message: 'The prerelease update was removed after switching to the stable channel.',
      });
    }
    return this.snapshot();
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
