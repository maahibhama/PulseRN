import { useCallback, useEffect, useState } from 'react';
import type { SessionArchiveResult, StoredSession } from '../../preload/api.js';

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function resultMessage(action: 'exported' | 'imported', result: SessionArchiveResult): string {
  if (result.canceled) return '';
  return `${result.sessions} session${result.sessions === 1 ? '' : 's'} and ${result.events.toLocaleString()} events ${action}.`;
}

export function SessionsPanel() {
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSessions(await window.pulseRN.listSessions());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load stored sessions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (
    operation: () => Promise<SessionArchiveResult>,
    action: 'exported' | 'imported',
  ) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await operation();
      setMessage(resultMessage(action, result));
      if (action === 'imported' && !result.canceled) await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Session ${action} failed.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="timeline sessions-panel">
      <div className="panel-header">
        <div>
          <strong>Sessions</strong>
          <span>{sessions.length} stored debugging sessions</span>
        </div>
        <div className="actions">
          <button
            disabled={busy || sessions.length === 0}
            onClick={() => void run(() => window.pulseRN.exportSessions(), 'exported')}
          >
            Export all
          </button>
          <button
            disabled={busy}
            onClick={() => void run(() => window.pulseRN.importSessions(), 'imported')}
          >
            Import
          </button>
          <button disabled={loading || busy} onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </div>
      {(message || error) && (
        <div className={error ? 'session-message error' : 'session-message'}>
          {error || message}
        </div>
      )}
      <div className="session-columns">
        <span>Application</span>
        <span>Device</span>
        <span>Last seen</span>
        <span>Events</span>
        <span />
      </div>
      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">◫</div>
            <h2>{loading ? 'Loading sessions…' : 'No stored sessions'}</h2>
            <p>Connected applications and imported PulseRN archives will appear here.</p>
          </div>
        ) : (
          sessions.map((session) => (
            <div className="session-entry" key={session.sessionId}>
              <span>
                <strong>{session.appName}</strong>
                <small>{session.appId}</small>
              </span>
              <span>
                <strong>{session.deviceName}</strong>
                <small>{session.platform}</small>
              </span>
              <time>{formatDate(session.lastSeenAt)}</time>
              <span>{session.eventCount.toLocaleString()}</span>
              <button
                disabled={busy}
                onClick={() =>
                  void run(() => window.pulseRN.exportSessions([session.sessionId]), 'exported')
                }
              >
                Export
              </button>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
