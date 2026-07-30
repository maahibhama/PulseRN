import type { AppSettings } from '../../preload/api.js';
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
