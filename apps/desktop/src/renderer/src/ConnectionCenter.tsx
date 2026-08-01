import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConnectedDevice } from '../../main/session-manager.js';
import type { ConnectionInfo, StoredDevice, StoredSession } from '../../preload/api.js';

function formatAge(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m ago`;
  return new Date(timestamp).toLocaleString();
}

export function ConnectionCenter({
  devices,
  onOpenSession,
}: {
  devices: ConnectedDevice[];
  onOpenSession(session: StoredSession): void;
}) {
  const [connection, setConnection] = useState<ConnectionInfo>();
  const [storedDevices, setStoredDevices] = useState<StoredDevice[]>([]);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const deviceKey = devices.map((device) => device.connectionId).join(',');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [nextConnection, nextDevices, nextSessions] = await Promise.all([
        window.pulseRN.getConnectionInfo(),
        window.pulseRN.listStoredDevices(),
        window.pulseRN.listSessions(),
      ]);
      setConnection(nextConnection);
      setStoredDevices(nextDevices);
      setSessions(nextSessions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load connection diagnostics.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    return window.pulseRN.onConnectionInfo(setConnection);
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [deviceKey, refresh]);

  const totals = useMemo(
    () =>
      devices.reduce(
        (result, device) => ({
          queued: result.queued + (device.health?.queuedEvents ?? 0),
          dropped: result.dropped + (device.health?.droppedEvents ?? 0),
        }),
        { queued: 0, dropped: 0 },
      ),
    [devices],
  );

  const beginPairing = async () => {
    setBusy(true);
    setError('');
    try {
      const info = await window.pulseRN.beginPairing();
      setConnection(info);
      if (info.pairing) await navigator.clipboard.writeText(info.pairing.code);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to begin pairing.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (appId: string, deviceId: string) => {
    setBusy(true);
    setError('');
    try {
      setConnection(await window.pulseRN.revokeTrustedDevice(appId, deviceId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to revoke the trusted device.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="timeline connection-center">
      <div className="panel-header">
        <div>
          <strong>Connection center</strong>
          <span>
            {connection?.mode === 'lan' ? 'Authenticated LAN' : 'Loopback only'} · {devices.length}{' '}
            active
          </span>
        </div>
        <div className="actions">
          {connection?.mode === 'lan' && (
            <button disabled={busy} onClick={() => void beginPairing()}>
              Create pairing code
            </button>
          )}
          <button disabled={busy} onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </div>

      <div className="connection-center-scroll">
        {error && <div className="session-message error">{error}</div>}
        {connection?.pairing && (
          <section className="pairing-banner">
            <span>One-time pairing code</span>
            <strong>{connection.pairing.code}</strong>
            <small>
              Copied to clipboard · expires{' '}
              {new Date(connection.pairing.expiresAt).toLocaleTimeString()} ·{' '}
              {connection.pairing.remainingAttempts} attempts
            </small>
          </section>
        )}

        <section className="connection-summary">
          <div>
            <span>Active devices</span>
            <strong>{devices.length}</strong>
          </div>
          <div>
            <span>Queued events</span>
            <strong>{totals.queued}</strong>
          </div>
          <div>
            <span>Dropped events</span>
            <strong className={totals.dropped ? 'danger-text' : ''}>{totals.dropped}</strong>
          </div>
          <div>
            <span>Trusted devices</span>
            <strong>
              {connection?.trustedDevices.filter((device) => device.status === 'trusted').length ??
                0}
            </strong>
          </div>
        </section>

        <section className="connection-section">
          <header>
            <strong>Active connections</strong>
            <small>Live SDK and transport diagnostics</small>
          </header>
          {devices.length === 0 ? (
            <p className="connection-empty">Waiting for a PulseRN SDK connection.</p>
          ) : (
            devices.map((device) => {
              const latency = device.health
                ? Math.max(0, device.health.receivedAt - device.health.sentAt)
                : undefined;
              return (
                <div className="connection-device" key={device.connectionId}>
                  <span>
                    <strong>{device.device.name}</strong>
                    <small>
                      {device.device.appName} {device.device.appVersion ?? ''}
                    </small>
                  </span>
                  <span>
                    <strong>SDK {device.device.sdkVersion}</strong>
                    <small>Protocol {device.protocolVersion ?? 'unknown'}</small>
                  </span>
                  <span>
                    <strong>{device.trustStatus ?? 'unknown'}</strong>
                    <small>{device.remoteAddress ?? 'local'}</small>
                  </span>
                  <span>
                    <strong>{latency === undefined ? '—' : `${latency} ms`}</strong>
                    <small>
                      clock {device.health ? `${device.health.clockOffsetMs} ms` : 'unknown'}
                    </small>
                  </span>
                  <span>
                    <strong>{device.health?.queuedEvents ?? 0} queued</strong>
                    <small>{device.health?.droppedEvents ?? 0} dropped</small>
                  </span>
                </div>
              );
            })
          )}
        </section>

        <section className="connection-section">
          <header>
            <strong>Trusted devices</strong>
            <small>Reconnect tokens are stored only as SHA-256 hashes</small>
          </header>
          {connection?.trustedDevices.length ? (
            connection.trustedDevices.map((device) => (
              <div className="trusted-device" key={`${device.appId}:${device.deviceId}`}>
                <span>
                  <strong>{device.deviceName}</strong>
                  <small>{device.appName}</small>
                </span>
                <span>
                  <strong>{device.status}</strong>
                  <small>last used {formatAge(device.lastUsedAt)}</small>
                </span>
                <button
                  className="danger-button"
                  disabled={busy || device.status === 'revoked'}
                  onClick={() => void revoke(device.appId, device.deviceId)}
                >
                  Revoke
                </button>
              </div>
            ))
          ) : (
            <p className="connection-empty">No LAN devices have been paired.</p>
          )}
        </section>

        <section className="connection-section">
          <header>
            <strong>Recent sessions</strong>
            <small>{storedDevices.length} persisted device identities</small>
          </header>
          {sessions.slice(0, 20).map((session) => (
            <div className="connection-session" key={session.sessionId}>
              <span>
                <strong>{session.displayName || session.appName}</strong>
                <small>{session.deviceName}</small>
              </span>
              <span>
                <strong>{session.endedAt ? 'Disconnected' : 'Active or interrupted'}</strong>
                <small>{session.disconnectReason || formatAge(session.lastSeenAt)}</small>
              </span>
              <span>
                <strong>{session.eventCount.toLocaleString()} events</strong>
                <small>{session.trustStatus || 'legacy session'}</small>
              </span>
              <button onClick={() => onOpenSession(session)}>Open</button>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
