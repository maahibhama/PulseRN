import { navigationEventPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useEffect, useMemo, useState } from 'react';

interface NavigationPanelProps {
  events: DevToolEventEnvelope[];
  selectedEventId?: string;
  onSelect(id: string): void;
}

export function NavigationPanel({ events, selectedEventId, onSelect }: NavigationPanelProps) {
  const navigationEvents = useMemo(
    () => events.filter((event) => event.category === 'navigation'),
    [events],
  );
  const [displayedEvents, setDisplayedEvents] = useState(navigationEvents);
  const [paused, setPaused] = useState(false);
  const [clearedAt, setClearedAt] = useState(0);
  const [search, setSearch] = useState('');
  const [navigatorFilter, setNavigatorFilter] = useState('ALL');

  useEffect(() => {
    if (!paused) setDisplayedEvents(navigationEvents);
  }, [navigationEvents, paused]);

  const navigators = useMemo(() => {
    const values = new Set<string>();
    for (const event of navigationEvents) {
      const parsed = navigationEventPayloadSchema.safeParse(event.payload);
      if (parsed.success) values.add(parsed.data.navigatorId);
    }
    return ['ALL', ...values];
  }, [navigationEvents]);

  const filtered = displayedEvents.filter((event) => {
    if (event.timestamp <= clearedAt) return false;
    const parsed = navigationEventPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return false;
    const payload = parsed.data;
    if (navigatorFilter !== 'ALL' && payload.navigatorId !== navigatorFilter) return false;
    const query = search.trim().toLowerCase();
    return (
      !query ||
      payload.currentRoute?.name.toLowerCase().includes(query) ||
      payload.previousRoute?.name.toLowerCase().includes(query)
    );
  });

  return (
    <main className="timeline navigation-panel">
      <div className="panel-header">
        <div>
          <strong>Navigation</strong>
          <span>
            {filtered.length} of {navigationEvents.length} lifecycle events
          </span>
        </div>
        <div className="actions">
          <button className={paused ? 'control-active' : ''} onClick={() => setPaused(!paused)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={() => setClearedAt(Date.now())}>Clear</button>
        </div>
      </div>
      <div className="network-toolbar">
        <select
          value={navigatorFilter}
          onChange={(event) => setNavigatorFilter(event.target.value)}
        >
          {navigators.map((navigator) => (
            <option key={navigator}>{navigator}</option>
          ))}
        </select>
        <input
          aria-label="Search navigation routes"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter routes…"
          type="search"
          value={search}
        />
      </div>
      <div className="navigation-columns">
        <span>Lifecycle</span>
        <span>Transition</span>
        <span>Action</span>
        <span>Duration</span>
      </div>
      <div className="navigation-list">
        {filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">→</div>
            <h2>{navigationEvents.length ? 'No matching routes' : 'No navigation events yet'}</h2>
            <p>Route transitions from the connected application will appear here.</p>
          </div>
        ) : (
          [...filtered].reverse().map((event) => {
            const parsed = navigationEventPayloadSchema.safeParse(event.payload);
            if (!parsed.success) return null;
            const payload = parsed.data;
            return (
              <button
                className={
                  event.id === selectedEventId ? 'navigation-entry selected' : 'navigation-entry'
                }
                key={event.id}
                onClick={() => onSelect(event.id)}
              >
                <span className={`lifecycle-badge ${payload.lifecycle}`}>{payload.lifecycle}</span>
                <strong>
                  {payload.previousRoute?.name ?? 'Start'}
                  <span> → </span>
                  {payload.currentRoute?.name ?? 'Unknown'}
                </strong>
                <span>{payload.action}</span>
                <span>
                  {payload.previousRouteDuration === undefined
                    ? '—'
                    : `${payload.previousRouteDuration.toFixed(0)} ms`}
                </span>
              </button>
            );
          })
        )}
      </div>
    </main>
  );
}
