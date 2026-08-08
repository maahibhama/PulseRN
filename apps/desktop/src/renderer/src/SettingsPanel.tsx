import { useEffect, useState } from 'react';
import type {
  AppSettings,
  AppearanceState,
  ConnectionInfo,
  DatabaseMaintenanceReport,
  DebuggerState,
  DesktopUpdateState,
} from '../../preload/api.js';
import darkAppIcon from '../../../resources/pulse-rn-app-icon-dark.png';
import lightAppIcon from '../../../resources/pulse-rn-app-icon-light.png';
import darkLogo from '../../../resources/pulse-rn-dark.png';
import lightLogo from '../../../resources/pulse-rn-light.png';
import { AppearanceSettings } from './AppearanceSettings.js';

interface SettingsPanelProps {
  deviceCount: number;
  eventCount: number;
  resolvedTheme: 'dark' | 'light';
  settings: AppSettings;
  onChange(patch: Partial<AppSettings>): Promise<void>;
  appearance?: AppearanceState;
  onAppearanceChange(state: AppearanceState): void;
}

function Toggle({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        checked={checked}
        className="setting-toggle"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

export function SettingsPanel({
  deviceCount,
  eventCount,
  resolvedTheme,
  settings,
  onChange,
  appearance,
  onAppearanceChange,
}: SettingsPanelProps) {
  const isWeb = window.pulseRNRuntime === 'web';
  const [maintenance, setMaintenance] = useState<DatabaseMaintenanceReport>();
  const [maintenanceError, setMaintenanceError] = useState('');
  const [maintaining, setMaintaining] = useState(false);
  const [connection, setConnection] = useState<ConnectionInfo>();
  const [connectionError, setConnectionError] = useState('');
  const [updateState, setUpdateState] = useState<DesktopUpdateState>();
  const [updateError, setUpdateError] = useState('');
  const [debuggerState, setDebuggerState] = useState<DebuggerState>();

  useEffect(() => {
    void window.pulseRN
      .getConnectionInfo()
      .then(setConnection)
      .catch((error: unknown) =>
        setConnectionError(
          error instanceof Error ? error.message : 'Unable to load connection info.',
        ),
      );
    return window.pulseRN.onConnectionInfo(setConnection);
  }, []);

  useEffect(() => {
    void window.pulseRN
      .getDebuggerState()
      .then(setDebuggerState)
      .catch(() => undefined);
    return window.pulseRN.onDebuggerState(setDebuggerState);
  }, []);

  const refreshOnboarding = async () => {
    try {
      await window.pulseRN.discoverDebuggerTargets();
      setDebuggerState(await window.pulseRN.getDebuggerState());
    } catch {
      setDebuggerState(await window.pulseRN.getDebuggerState());
    }
  };

  const onboardingSteps = [
    {
      label: 'Install @pulse-rn/sdk',
      detail: 'Add the root SDK import to a development build.',
      complete: deviceCount > 0 || eventCount > 0,
    },
    {
      label: `Desktop server on port ${settings.devToolPort}`,
      detail: 'The local debugger WebSocket port is valid and ready.',
      complete: settings.devToolPort >= 1_024 && settings.devToolPort <= 65_535,
    },
    {
      label: 'Connect a device',
      detail: 'Start the Expo or React Native CLI example.',
      complete: deviceCount > 0,
    },
    {
      label: `Discover Metro on port ${settings.metroPort}`,
      detail: 'Metro must be running on the same computer.',
      complete: (debuggerState?.targets.length ?? 0) > 0,
    },
    {
      label: 'Verify Hermes',
      detail: 'A Hermes CDP target must be discoverable.',
      complete: Boolean(debuggerState?.activeTargetId) || (debuggerState?.targets.length ?? 0) > 0,
    },
    {
      label: 'Capture the first event',
      detail: 'Trigger any instrumented action in the app.',
      complete: eventCount > 0,
    },
  ];

  useEffect(() => {
    void window.pulseRN
      .getUpdateState()
      .then(setUpdateState)
      .catch((error: unknown) =>
        setUpdateError(error instanceof Error ? error.message : 'Unable to load update status.'),
      );
    return window.pulseRN.onUpdateState(setUpdateState);
  }, []);

  const createPairingCode = async () => {
    setConnectionError('');
    try {
      const info = await window.pulseRN.beginPairing();
      setConnection(info);
      if (info.pairing?.code) await navigator.clipboard.writeText(info.pairing.code);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Unable to create pairing code.');
    }
  };

  const updateConnectionSettings = async (patch: Partial<AppSettings>) => {
    setConnectionError('');
    try {
      await onChange(patch);
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Unable to restart the debugger server.',
      );
    }
  };

  const installTls = async () => {
    setConnectionError('');
    try {
      setConnection(await window.pulseRN.installTlsCertificate());
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Unable to configure TLS certificate.',
      );
    }
  };

  const disableTls = async () => {
    setConnectionError('');
    try {
      setConnection(await window.pulseRN.disableTls());
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Unable to disable TLS.');
    }
  };

  const runMaintenance = async (clear = false) => {
    setMaintaining(true);
    setMaintenanceError('');
    try {
      setMaintenance(
        clear
          ? await window.pulseRN.clearStoredEvents()
          : await window.pulseRN.runDatabaseMaintenance(),
      );
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : 'Database operation failed.');
    } finally {
      setMaintaining(false);
    }
  };

  const runUpdateOperation = async (operation: 'check' | 'download' | 'install'): Promise<void> => {
    setUpdateError('');
    try {
      const next =
        operation === 'check'
          ? await window.pulseRN.checkForUpdates()
          : operation === 'download'
            ? await window.pulseRN.downloadUpdate()
            : await window.pulseRN.installUpdate();
      setUpdateState(next);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : 'Update operation failed.');
    }
  };

  return (
    <main className="timeline settings-panel">
      <div className="panel-header">
        <div>
          <strong>Settings</strong>
          <span>Saved automatically on this Mac</span>
        </div>
      </div>
      <div className="settings-scroll">
        <section className="settings-hero">
          <img alt="PulseRN" src={resolvedTheme === 'light' ? lightAppIcon : darkAppIcon} />
          <div>
            <h1>PulseRN preferences</h1>
            <p>Customize the debugger interface and native macOS behavior.</p>
          </div>
        </section>

        {!settings.onboardingDismissed && (
          <section className="settings-card onboarding-card" aria-labelledby="onboarding-title">
            <header>
              <strong id="onboarding-title">First-run checklist</strong>
              <small>
                {onboardingSteps.filter((step) => step.complete).length}/{onboardingSteps.length}{' '}
                ready
              </small>
            </header>
            <ol>
              {onboardingSteps.map((step) => (
                <li className={step.complete ? 'complete' : ''} key={step.label}>
                  <span aria-hidden="true">{step.complete ? '✓' : '○'}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>{step.detail}</small>
                  </div>
                </li>
              ))}
            </ol>
            <div className="connection-actions">
              <button onClick={() => void refreshOnboarding()}>Refresh checks</button>
              <button onClick={() => void onChange({ onboardingDismissed: true })}>
                Dismiss checklist
              </button>
            </div>
          </section>
        )}

        <section className="settings-card">
          <header>
            <strong>Debugger</strong>
            <small>Hermes through Metro</small>
          </header>
          <label className="setting-row">
            <span>
              <strong>Metro port</strong>
              <small>PulseRN discovers local Hermes debugger targets on this port.</small>
            </span>
            <input
              aria-label="Metro port"
              max={65_535}
              min={1}
              type="number"
              value={settings.metroPort}
              onChange={(event) => {
                const metroPort = Number(event.target.value);
                if (Number.isInteger(metroPort) && metroPort >= 1 && metroPort <= 65_535) {
                  void onChange({ metroPort });
                }
              }}
            />
          </label>
        </section>

        <section className="settings-card">
          <header>
            <strong>Connections</strong>
            <small>
              {settings.allowLanConnections ? 'Authenticated LAN' : 'Local computer only'}
            </small>
          </header>
          <Toggle
            checked={settings.allowLanConnections}
            description="Bind to local network interfaces. New devices must complete one-time pairing."
            label="Allow authenticated LAN connections"
            onChange={(allowLanConnections) =>
              void updateConnectionSettings({ allowLanConnections })
            }
          />
          <label className="setting-row">
            <span>
              <strong>Debugger server port</strong>
              <small>Restarting the server disconnects currently attached devices.</small>
            </span>
            <input
              aria-label="Debugger server port"
              max={65_535}
              min={1_024}
              type="number"
              value={settings.devToolPort}
              onChange={(event) => {
                const devToolPort = Number(event.target.value);
                if (
                  Number.isInteger(devToolPort) &&
                  devToolPort >= 1_024 &&
                  devToolPort <= 65_535
                ) {
                  void updateConnectionSettings({ devToolPort });
                }
              }}
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Pairing code lifetime</strong>
              <small>One-time LAN pairing codes expire automatically.</small>
            </span>
            <select
              value={settings.pairingCodeLifetimeMinutes}
              onChange={(event) =>
                void onChange({ pairingCodeLifetimeMinutes: Number(event.target.value) })
              }
            >
              <option value={1}>1 minute</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={30}>30 minutes</option>
            </select>
          </label>
          <label className="setting-row">
            <span>
              <strong>Pairing retry limit</strong>
              <small>A code is invalidated after this many failed attempts.</small>
            </span>
            <input
              aria-label="Pairing retry limit"
              max={20}
              min={1}
              type="number"
              value={settings.pairingRetryLimit}
              onChange={(event) => {
                const pairingRetryLimit = Number(event.target.value);
                if (
                  Number.isInteger(pairingRetryLimit) &&
                  pairingRetryLimit >= 1 &&
                  pairingRetryLimit <= 20
                ) {
                  void onChange({ pairingRetryLimit });
                }
              }}
            />
          </label>
          <div className="connection-addresses">
            {(connection?.addresses ?? []).map((address) => (
              <code key={address}>{address}</code>
            ))}
            {connection?.requiresAuth && (
              <small>Set this host and port, then enter the one-time code in the SDK.</small>
            )}
            <small>
              Transport: {connection?.tls.enabled ? 'Encrypted wss://' : 'Plaintext ws://'}
            </small>
            {connection?.tls.fingerprint256 && (
              <code title="SHA-256 certificate fingerprint">
                SHA-256 {connection.tls.fingerprint256}
              </code>
            )}
            {connection?.tls.validTo && (
              <small>Certificate valid until {connection.tls.validTo}</small>
            )}
            {connection?.pairing && (
              <>
                <code className="access-token">{connection.pairing.code}</code>
                <small>
                  Pairing code expires at{' '}
                  {new Date(connection.pairing.expiresAt).toLocaleTimeString()}.
                </small>
              </>
            )}
            {connectionError && <small className="settings-error">{connectionError}</small>}
          </div>
          {settings.allowLanConnections && (
            <div className="connection-actions token-actions">
              <button onClick={() => void createPairingCode()}>Create and copy pairing code</button>
            </div>
          )}
          <div className="tls-setting-row">
            <span>
              <strong>TLS encryption</strong>
              <small>
                Use a trusted certificate that covers the configured hostname or IP address.
              </small>
            </span>
            <div className="connection-actions">
              <button onClick={() => void installTls()}>
                {connection?.tls.configured ? 'Replace certificate' : 'Configure TLS'}
              </button>
              {connection?.tls.enabled && (
                <button className="danger-button" onClick={() => void disableTls()}>
                  Disable TLS
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="settings-card">
          <header>
            <strong>Storage</strong>
            <small>Bounded local SQLite storage</small>
          </header>
          <label className="setting-row">
            <span>
              <strong>Retention period</strong>
              <small>Events older than this are removed during background maintenance.</small>
            </span>
            <select
              value={settings.eventRetentionDays}
              onChange={(event) =>
                void onChange({ eventRetentionDays: Number(event.target.value) })
              }
            >
              <option value={1}>1 day</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>1 year</option>
            </select>
          </label>
          <label className="setting-row">
            <span>
              <strong>Maximum stored events</strong>
              <small>The oldest events are removed after this limit is reached.</small>
            </span>
            <select
              value={settings.maxStoredEvents}
              onChange={(event) => void onChange({ maxStoredEvents: Number(event.target.value) })}
            >
              <option value={10_000}>10,000</option>
              <option value={50_000}>50,000</option>
              <option value={100_000}>100,000</option>
              <option value={250_000}>250,000</option>
              <option value={1_000_000}>1,000,000</option>
            </select>
          </label>
          <div className="setting-row database-actions">
            <span>
              <strong>Database maintenance</strong>
              <small>
                {maintenance
                  ? `${maintenance.retainedEvents.toLocaleString()} retained · ${
                      maintenance.removedExpired +
                      maintenance.removedOverflow +
                      maintenance.removedInvalid
                    } removed`
                  : 'Apply retention now and recover malformed stored records.'}
              </small>
              {maintenanceError && <small className="settings-error">{maintenanceError}</small>}
            </span>
            <div>
              <button disabled={maintaining} onClick={() => void runMaintenance()}>
                {maintaining ? 'Working…' : 'Run cleanup'}
              </button>
              <button
                className="danger-button"
                disabled={maintaining}
                onClick={() => void runMaintenance(true)}
              >
                Delete history
              </button>
            </div>
          </div>
        </section>

        <section className="settings-card">
          <header>
            <strong>Capture</strong>
            <small>Bounded instrumentation budgets</small>
          </header>
          <label className="setting-row">
            <span>
              <strong>Console event limit</strong>
              <small>Maximum console events retained by a loaded inspector session.</small>
            </span>
            <input
              aria-label="Console event limit"
              max={100_000}
              min={1}
              type="number"
              value={settings.consoleCaptureLimit}
              onChange={(event) => {
                const consoleCaptureLimit = Number(event.target.value);
                if (Number.isInteger(consoleCaptureLimit) && consoleCaptureLimit >= 1) {
                  void onChange({ consoleCaptureLimit });
                }
              }}
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Network body budget</strong>
              <small>Maximum captured text body size per request in KiB.</small>
            </span>
            <input
              aria-label="Network body budget in KiB"
              max={16_384}
              min={0}
              type="number"
              value={Math.round(settings.networkBodyCaptureBytes / 1_024)}
              onChange={(event) => {
                const kib = Number(event.target.value);
                if (Number.isInteger(kib) && kib >= 0 && kib <= 16_384) {
                  void onChange({ networkBodyCaptureBytes: kib * 1_024 });
                }
              }}
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Diagnostics interval</strong>
              <small>Connection health sampling interval in milliseconds.</small>
            </span>
            <input
              aria-label="Diagnostics interval"
              max={60_000}
              min={250}
              step={250}
              type="number"
              value={settings.diagnosticsIntervalMs}
              onChange={(event) => {
                const diagnosticsIntervalMs = Number(event.target.value);
                if (
                  Number.isInteger(diagnosticsIntervalMs) &&
                  diagnosticsIntervalMs >= 250 &&
                  diagnosticsIntervalMs <= 60_000
                ) {
                  void onChange({ diagnosticsIntervalMs });
                }
              }}
            />
          </label>
        </section>

        <section className="settings-card">
          <header>
            <strong>Privacy</strong>
            <small>Redaction before persistence and export</small>
          </header>
          <label className="setting-row">
            <span>
              <strong>Sensitive field names</strong>
              <small>Comma-separated, case-insensitive keys redacted from captured data.</small>
            </span>
            <input
              aria-label="Sensitive field names"
              type="text"
              value={settings.redactionFields.join(', ')}
              onChange={(event) => {
                const redactionFields = event.target.value
                  .split(',')
                  .map((field) => field.trim())
                  .filter(Boolean)
                  .slice(0, 100);
                void onChange({ redactionFields });
              }}
            />
          </label>
          <p className="settings-note">
            PulseRN keeps captured data local by default. Pairing credentials are never included in
            events, exports, or diagnostics.
          </p>
        </section>

        <AppearanceSettings appearance={appearance} onChange={onAppearanceChange} />
        <section className="settings-card">
          <header>
            <strong>Layout &amp; motion</strong>
            <small>Changes apply immediately</small>
          </header>
          <label className="setting-row">
            <span>
              <strong>Interface density</strong>
              <small>Compact mode displays more debugging events at once.</small>
            </span>
            <select
              value={settings.density}
              onChange={(event) =>
                void onChange({ density: event.target.value as AppSettings['density'] })
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <label className="setting-row">
            <span>
              <strong>Timeline order</strong>
              <small>Choose which end of the timeline receives new events.</small>
            </span>
            <select
              value={settings.timelineOrder}
              onChange={(event) =>
                void onChange({
                  timelineOrder: event.target.value as AppSettings['timelineOrder'],
                })
              }
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
          <label className="setting-row">
            <span>
              <strong>Motion</strong>
              <small>Follow system preferences or override interface animation.</small>
            </span>
            <select
              value={settings.motion}
              onChange={(event) =>
                void onChange({ motion: event.target.value as AppSettings['motion'] })
              }
            >
              <option value="system">System</option>
              <option value="reduced">Reduced</option>
              <option value="full">Full</option>
            </select>
          </label>
        </section>

        {!isWeb && (
          <section className="settings-card">
            <header>
              <strong>Updates</strong>
              <small>PulseRN {updateState?.currentVersion ?? '—'}</small>
            </header>
            <label className="setting-row">
              <span>
                <strong>Update channel</strong>
                <small>Stable receives production releases; beta includes previews.</small>
              </span>
              <select
                value={settings.updateChannel}
                onChange={(event) =>
                  void onChange({
                    updateChannel: event.target.value as AppSettings['updateChannel'],
                  })
                }
              >
                <option value="stable">Stable</option>
                <option value="beta">Beta</option>
              </select>
            </label>
            <Toggle
              checked={settings.checkForUpdatesAutomatically}
              description="Check GitHub Releases after PulseRN starts. Downloads and installation still require your approval."
              label="Check automatically"
              onChange={(checkForUpdatesAutomatically) =>
                void onChange({ checkForUpdatesAutomatically })
              }
            />
            <div className="update-status-row">
              <span>
                <strong>
                  {updateState?.status === 'available'
                    ? `Version ${updateState.availableVersion ?? ''} is available`
                    : updateState?.status === 'downloaded'
                      ? 'Ready to install'
                      : updateState?.status === 'downloading'
                        ? 'Downloading update'
                        : updateState?.status === 'checking'
                          ? 'Checking for updates'
                          : updateState?.status === 'up-to-date'
                            ? 'PulseRN is up to date'
                            : updateState?.status === 'error'
                              ? 'Update check failed'
                              : updateState?.enabled
                                ? 'Ready to check'
                                : 'Automatic installation unavailable'}
                </strong>
                <small>{updateError || updateState?.message}</small>
                {updateState?.status === 'downloading' && (
                  <progress max={100} value={updateState.progress ?? 0} />
                )}
              </span>
              <div className="connection-actions">
                {updateState?.status === 'available' ? (
                  <button onClick={() => void runUpdateOperation('download')}>Download</button>
                ) : updateState?.status === 'downloaded' ? (
                  <button onClick={() => void runUpdateOperation('install')}>
                    Restart and install
                  </button>
                ) : (
                  <button
                    disabled={
                      !updateState?.enabled ||
                      updateState.status === 'checking' ||
                      updateState.status === 'downloading'
                    }
                    onClick={() => void runUpdateOperation('check')}
                  >
                    Check now
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {!isWeb && (
          <section className="settings-card">
            <header>
              <strong>Appearance · macOS</strong>
              <small>Native application behavior</small>
            </header>
            <Toggle
              checked={settings.launchAtLogin}
              description="Open PulseRN automatically when you sign in."
              label="Launch at login"
              onChange={(launchAtLogin) => void onChange({ launchAtLogin })}
            />
            <Toggle
              checked={settings.keepRunningInBackground}
              description="Closing the window hides PulseRN while keeping device connections alive."
              label="Keep running after window closes"
              onChange={(keepRunningInBackground) => void onChange({ keepRunningInBackground })}
            />
          </section>
        )}

        <section className="settings-card logo-library">
          <header>
            <strong>Appearance · Brand assets</strong>
            <small>Theme-specific PulseRN logos</small>
          </header>
          <div>
            <figure>
              <img alt="PulseRN dark logo" src={darkLogo} />
              <figcaption>Dark</figcaption>
            </figure>
            <figure>
              <img alt="PulseRN light logo" src={lightLogo} />
              <figcaption>Light</figcaption>
            </figure>
          </div>
        </section>
      </div>
    </main>
  );
}
