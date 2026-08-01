import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  UpdateManager,
  type DesktopUpdaterAdapter,
  type DesktopUpdateState,
} from './update-manager.js';

class FakeUpdater extends EventEmitter implements DesktopUpdaterAdapter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  checkForUpdates = vi.fn(async () => undefined);
  downloadUpdate = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();
}

describe('UpdateManager', () => {
  it('keeps development and unsigned builds disabled', async () => {
    const updater = new FakeUpdater();
    const manager = new UpdateManager(updater, {
      enabled: false,
      currentVersion: '0.1.2',
      disabledReason: 'Signed release required.',
      onState: vi.fn(),
    });

    expect(manager.snapshot()).toMatchObject({
      enabled: false,
      status: 'disabled',
      message: 'Signed release required.',
    });
    await expect(manager.check()).rejects.toThrow('Signed release required.');
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it('checks, downloads, reports progress, and installs only after download', async () => {
    const updater = new FakeUpdater();
    const states: DesktopUpdateState[] = [];
    const manager = new UpdateManager(updater, {
      enabled: true,
      currentVersion: '0.2.0-beta.1',
      onState: (state) => states.push(state),
    });

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(true);
    await manager.check();
    updater.emit('update-available', { version: '0.2.0-beta.2' });
    await manager.download();
    updater.emit('download-progress', { percent: 48.25 });
    updater.emit('update-downloaded', { version: '0.2.0-beta.2' });

    expect(manager.snapshot()).toMatchObject({
      status: 'downloaded',
      availableVersion: '0.2.0-beta.2',
      progress: 100,
    });
    manager.install();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(states.some((state) => state.status === 'downloading' && state.progress === 48.25)).toBe(
      true,
    );
  });

  it('surfaces updater failures as bounded renderer state', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('release service unavailable'));
    const manager = new UpdateManager(updater, {
      enabled: true,
      currentVersion: '0.1.2',
      onState: vi.fn(),
    });

    await expect(manager.check()).resolves.toMatchObject({
      status: 'error',
      message: 'release service unavailable',
    });
  });
});
