import type { DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useEffect, useState } from 'react';
import { ConsolePanel } from './ConsolePanel.js';
import { EventDetails } from './EventDetails.js';
import { NetworkPanel } from './NetworkPanel.js';
import { NavigationPanel } from './NavigationPanel.js';
import { ReduxPanel } from './ReduxPanel.js';
import { deviceLabel, findSelectedEvent, useDesktopStore } from './store.js';

type ViewName =
  | 'Timeline'
  | 'Console'
  | 'Network'
  | 'Redux'
  | 'Navigation'
  | 'Performance'
  | 'Storage'
  | 'Errors';

const navItems: { name: ViewName; icon: string; available: boolean }[] = [
  { name: 'Timeline', icon: '⌁', available: true },
  { name: 'Console', icon: '>_', available: true },
  { name: 'Network', icon: '⇄', available: true },
  { name: 'Redux', icon: '◇', available: true },
  { name: 'Navigation', icon: '→', available: true },
  { name: 'Performance', icon: '⌁', available: false },
  { name: 'Storage', icon: '▤', available: false },
  { name: 'Errors', icon: '△', available: false },
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

function TimelinePanel({
  events,
  selectedEventId,
  onSelect,
}: {
  events: DevToolEventEnvelope[];
  selectedEventId?: string;
  onSelect(id: string): void;
}) {
  const [paused, setPaused] = useState(false);
  const [visibleEvents, setVisibleEvents] = useState(events);
  const [clearedAt, setClearedAt] = useState(0);

  useEffect(() => {
    if (!paused) setVisibleEvents(events);
  }, [events, paused]);

  const displayed = visibleEvents.filter((event) => event.timestamp > clearedAt);
  return (
    <main className="timeline">
      <div className="panel-header">
        <div>
          <strong>Unified timeline</strong>
          <span>{displayed.length} events</span>
        </div>
        <div className="actions">
          <button className={paused ? 'control-active' : ''} onClick={() => setPaused(!paused)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={() => setClearedAt(Date.now())}>Clear</button>
        </div>
      </div>
      <div className="column-head">
        <span>Time</span>
        <span>Category</span>
        <span>Event</span>
      </div>
      <div className="event-list">
        {displayed.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">⌁</div>
            <h2>Ready to inspect</h2>
            <p>Connect the example React Native app to see its events here.</p>
            <code>ws://127.0.0.1:9090</code>
          </div>
        ) : (
          [...displayed].reverse().map((event) => (
            <button
              className={event.id === selectedEventId ? 'event selected' : 'event'}
              key={event.id}
              onClick={() => onSelect(event.id)}
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
  );
}

function UpcomingPanel({ view }: { view: ViewName }) {
  return (
    <main className="timeline">
      <div className="panel-header">
        <strong>{view}</strong>
      </div>
      <div className="empty">
        <div className="empty-icon">◇</div>
        <h2>{view} is planned</h2>
        <p>This inspector belongs to a later implementation phase.</p>
      </div>
    </main>
  );
}

export function App() {
  const { devices, events, selectedEventId, setSnapshot, selectEvent } = useDesktopStore();
  const [activeView, setActiveView] = useState<ViewName>('Timeline');
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
        <div className="phase-pill">Phase 5 · Navigation</div>
      </header>
      <aside className="sidebar">
        <div className="section-label">Inspect</div>
        {navItems.map((item) => (
          <button
            className={`${activeView === item.name ? 'nav active' : 'nav'} ${item.available ? '' : 'upcoming'}`}
            key={item.name}
            onClick={() => setActiveView(item.name)}
          >
            <span>{item.icon}</span>
            {item.name}
            {!item.available && <small>Soon</small>}
          </button>
        ))}
        <div className="sidebar-footer">
          <span className={devices.length ? 'status online' : 'status'} />
          WebSocket :9090
        </div>
      </aside>
      {activeView === 'Timeline' ? (
        <TimelinePanel events={events} selectedEventId={selectedEventId} onSelect={selectEvent} />
      ) : activeView === 'Console' ? (
        <ConsolePanel events={events} selectedEventId={selectedEventId} onSelect={selectEvent} />
      ) : activeView === 'Network' ? (
        <NetworkPanel events={events} selectedEventId={selectedEventId} onSelect={selectEvent} />
      ) : activeView === 'Redux' ? (
        <ReduxPanel events={events} selectedEventId={selectedEventId} onSelect={selectEvent} />
      ) : activeView === 'Navigation' ? (
        <NavigationPanel events={events} selectedEventId={selectedEventId} onSelect={selectEvent} />
      ) : (
        <UpcomingPanel view={activeView} />
      )}
      <EventDetails event={selected} />
    </div>
  );
}
