import { useEffect } from 'react';
import { deviceLabel, findSelectedEvent, useDesktopStore } from './store.js';

const navItems = [
  'Timeline',
  'Console',
  'Network',
  'Redux',
  'Navigation',
  'Performance',
  'Storage',
  'Errors',
];

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

export function App() {
  const { devices, events, selectedEventId, setSnapshot, selectEvent } = useDesktopStore();
  const selected = findSelectedEvent(events, selectedEventId);
  const desktopApi = window.pulseRN;

  useEffect(() => {
    if (!desktopApi) return;
    void desktopApi.getSnapshot().then(setSnapshot);
    return desktopApi.onSnapshot(setSnapshot);
  }, [desktopApi, setSnapshot]);

  if (!desktopApi) {
    return (
      <div className="startup-error">
        <div>
          <span>PulseRN failed to start</span>
          <h1>Desktop bridge unavailable</h1>
          <p>Restart the Electron development process to reload the secure preload script.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="pulse">◉</span> PulseRN
        </div>
        <div className="device-pill">
          <span className={devices.length ? 'status online' : 'status'} />
          {devices.length === 0
            ? 'Waiting for device'
            : devices.length === 1
              ? deviceLabel(devices[0]!)
              : `${devices.length} devices connected`}
        </div>
        <div className="search">⌘K&nbsp;&nbsp; Search events</div>
      </header>
      <aside className="sidebar">
        <div className="section-label">Inspect</div>
        {navItems.map((item, index) => (
          <button className={index === 0 ? 'nav active' : 'nav'} key={item}>
            <span>{['⌁', '›_', '⇄', '◇', '→', '⌁', '▤', '△'][index]}</span>
            {item}
          </button>
        ))}
        <div className="sidebar-footer">
          <span className="status online" />
          WebSocket :9090
        </div>
      </aside>
      <main className="timeline">
        <div className="panel-header">
          <div>
            <strong>Unified timeline</strong>
            <span>{events.length} events</span>
          </div>
          <div className="actions">
            <button>Pause</button>
            <button>Clear</button>
          </div>
        </div>
        <div className="column-head">
          <span>Time</span>
          <span>Category</span>
          <span>Event</span>
        </div>
        <div className="event-list">
          {events.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">⌁</div>
              <h2>Ready to inspect</h2>
              <p>Connect the example React Native app to see its events here.</p>
              <code>ws://127.0.0.1:9090</code>
            </div>
          ) : (
            [...events].reverse().map((event) => (
              <button
                className={event.id === selectedEventId ? 'event selected' : 'event'}
                key={event.id}
                onClick={() => selectEvent(event.id)}
              >
                <time>{formatTime(event.timestamp)}</time>
                <span className={`category ${event.category}`}>{event.category}</span>
                <span>
                  <strong>{event.type}</strong>
                  <small>#{event.sequence}</small>
                </span>
              </button>
            ))
          )}
        </div>
      </main>
      <aside className="details">
        <div className="panel-header">
          <strong>Event details</strong>
        </div>
        {selected ? (
          <div className="detail-content">
            <div className="detail-grid">
              <span>Type</span>
              <strong>{selected.type}</strong>
              <span>Category</span>
              <strong>{selected.category}</strong>
              <span>Sequence</span>
              <strong>{selected.sequence}</strong>
              <span>Session</span>
              <strong>{selected.sessionId}</strong>
            </div>
            <h3>Payload</h3>
            <pre>{JSON.stringify(selected.payload, null, 2)}</pre>
          </div>
        ) : (
          <div className="details-empty">
            Select an event to inspect its validated envelope and payload.
          </div>
        )}
      </aside>
    </div>
  );
}
