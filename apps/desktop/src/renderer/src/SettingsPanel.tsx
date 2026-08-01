import { useEffect, useState } from 'react';
import type { AppSettings, ConnectionInfo, DatabaseMaintenanceReport } from '../../preload/api.js';
import darkAppIcon from '../../../resources/pulse-rn-app-icon-dark.png';
import lightAppIcon from '../../../resources/pulse-rn-app-icon-light.png';
import darkLogo from '../../../resources/pulse-rn-dark.png';
import lightLogo from '../../../resources/pulse-rn-light.png';

interface SettingsPanelProps {
  resolvedTheme: 'dark' | 'light';
  settings: AppSettings;
  onChange(patch: Partial<AppSettings>): Promise<void>;
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

export function SettingsPanel({ resolvedTheme, settings, onChange }: SettingsPanelProps) {
  const [maintenance, setMaintenance] = useState<DatabaseMaintenanceReport>();
  const [maintenanceError, setMaintenanceError] = useState('');
  const [maintaining, setMaintaining] = useState(false);
  const [connection, setConnection] = useState<ConnectionInfo>();
  const [connectionError, setConnectionError] = useState('');

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

  const copyAccessToken = async () => {
    setConnectionError('');
    try {
      const info = await window.pulseRN.revealConnectionToken();
      setConnection(info);
      if (info.accessToken) await navigator.clipboard.writeText(info.accessToken);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Unable to copy access token.');
    }
  };

  const rotateAccessToken = async () => {
    setConnectionError('');
    try {
      const info = await window.pulseRN.rotateConnectionToken();
      setConnection(info);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Unable to rotate access token.');
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

        <section className="settings-card">
          <header>
            <strong>JavaScript debugger</strong>
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
            <strong>Device connections</strong>
            <small>
              {settings.allowLanConnections ? 'Authenticated LAN' : 'Local computer only'}
            </small>
          </header>
          <Toggle
            checked={settings.allowLanConnections}
            description="Bind to local network interfaces. Every device must provide the generated access token."
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
          <div className="connection-addresses">
            {(connection?.addresses ?? []).map((address) => (
              <code key={address}>{address}</code>
            ))}
            {connection?.requiresAuth && (
              <small>Set this host, port, and `authToken` in the React Native SDK.</small>
            )}
            {connection?.accessToken && (
              <code className="access-token">{connection.accessToken}</code>
            )}
            {connectionError && <small className="settings-error">{connectionError}</small>}
          </div>
          {settings.allowLanConnections && (
            <div className="connection-actions">
              <button onClick={() => void copyAccessToken()}>Copy access token</button>
              <button className="danger-button" onClick={() => void rotateAccessToken()}>
                Rotate token
              </button>
            </div>
          )}
        </section>

        <section className="settings-card">
          <header>
            <strong>Event history</strong>
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
            <strong>Appearance</strong>
            <small>Changes apply immediately</small>
          </header>
          <label className="setting-row">
            <span>
              <strong>Color theme</strong>
              <small>Follow macOS or force a light or dark appearance.</small>
            </span>
            <select
              value={settings.theme}
              onChange={(event) =>
                void onChange({ theme: event.target.value as AppSettings['theme'] })
              }
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
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
        </section>

        <section className="settings-card">
          <header>
            <strong>macOS</strong>
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

        <section className="settings-card logo-library">
          <header>
            <strong>Brand assets</strong>
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
