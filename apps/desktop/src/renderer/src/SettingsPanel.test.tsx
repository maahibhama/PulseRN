// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AppSettings,
  ConnectionInfo,
  DebuggerState,
  DesktopUpdateState,
} from '../../preload/api.js';
import { SettingsPanel } from './SettingsPanel.js';
import { useDesktopStore } from './store.js';

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...useDesktopStore.getState().settings, ...overrides };
}

function renderSettings(
  overrides: Partial<AppSettings> = {},
  onChange = vi.fn<(patch: Partial<AppSettings>) => Promise<void>>().mockResolvedValue(undefined),
) {
  render(
    <SettingsPanel
      deviceCount={0}
      eventCount={0}
      onAppearanceChange={vi.fn()}
      onChange={onChange}
      resolvedTheme="light"
      settings={settings(overrides)}
    />,
  );
  return onChange;
}

beforeEach(() => {
  Object.defineProperty(window, 'pulseRNRuntime', {
    configurable: true,
    value: 'web',
  });
  Object.defineProperty(window, 'pulseRN', {
    configurable: true,
    value: {
      getConnectionInfo: vi.fn(async (): Promise<ConnectionInfo> => ({
        mode: 'loopback',
        port: 9_090,
        requiresAuth: false,
        addresses: [],
        trustedDevices: [],
        tls: { enabled: false, configured: false },
      })),
      getDebuggerState: vi.fn(async () => ({ targets: [] }) as unknown as DebuggerState),
      getUpdateState: vi.fn(async () => ({ status: 'idle' }) as DesktopUpdateState),
      onConnectionInfo: vi.fn(() => () => undefined),
      onDebuggerState: vi.fn(() => () => undefined),
      onUpdateState: vi.fn(() => () => undefined),
    } as unknown as Window['pulseRN'],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsPanel analytics consent', () => {
  it('renders equal allow and decline actions while consent is undecided', () => {
    renderSettings();

    const allow = screen.getByRole('button', { name: 'Allow anonymous usage analytics' });
    const decline = screen.getByRole('button', { name: 'No thanks' });

    expect(allow.className).toBe(decline.className);
    expect(allow.closest('section')).toBe(decline.closest('section'));
  });

  it('persists both analytics settings when consent is allowed', async () => {
    const onChange = renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Allow anonymous usage analytics' }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        anonymousUsageAnalytics: true,
        analyticsConsentDecided: true,
      }),
    );
  });

  it('persists decline without sending an analytics request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const onChange = renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        anonymousUsageAnalytics: false,
        analyticsConsentDecided: true,
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('turns analytics off when its identifier is deleted', async () => {
    const onChange = renderSettings({
      anonymousUsageAnalytics: true,
      analyticsConsentDecided: true,
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete analytics identifier and turn off' }),
    );

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        anonymousUsageAnalytics: false,
        analyticsConsentDecided: true,
      }),
    );
  });
});
