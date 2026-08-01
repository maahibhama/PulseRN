import { navigationEventPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useEffect, useMemo, useState } from 'react';
import { VirtualizedList } from './VirtualizedList.js';

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
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [groupFilter, setGroupFilter] = useState('ALL');

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
  const durations = useMemo(
    () =>
      displayedEvents
        .flatMap((event) => {
          const parsed = navigationEventPayloadSchema.safeParse(event.payload);
          return parsed.success &&
            parsed.data.previousRoute &&
            parsed.data.previousRouteDuration !== undefined
            ? [
                {
                  name: parsed.data.previousRoute.name,
                  duration: parsed.data.previousRouteDuration,
                },
              ]
            : [];
        })
        .slice(-20),
    [displayedEvents],
  );
  const maxDuration = Math.max(...durations.map(({ duration }) => duration), 1);

  const filtered = displayedEvents.filter((event) => {
    if (event.timestamp <= clearedAt) return false;
    const parsed = navigationEventPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return false;
    const payload = parsed.data;
    if (navigatorFilter !== 'ALL' && payload.navigatorId !== navigatorFilter) return false;
    if (sourceFilter !== 'ALL' && payload.source !== sourceFilter) return false;
    if (groupFilter !== 'ALL' && payload.actionGroup !== groupFilter) return false;
    const query = search.trim().toLowerCase();
    return (
      !query ||
      payload.currentRoute?.name.toLowerCase().includes(query) ||
      payload.previousRoute?.name.toLowerCase().includes(query) ||
      payload.routePath?.some((route) => route.toLowerCase().includes(query))
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
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
          <option>ALL</option>
          <option value="react-navigation">React Navigation</option>
          <option value="expo-router">Expo Router</option>
          <option value="manual">Manual</option>
        </select>
        <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
          <option>ALL</option>
          <option value="forward">Forward</option>
          <option value="backward">Backward</option>
          <option value="reset">Reset</option>
          <option value="lifecycle">Lifecycle</option>
          <option value="unknown">Unknown</option>
        </select>
        <input
          aria-label="Search navigation routes"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter routes…"
          type="search"
          value={search}
        />
      </div>
      {durations.length > 0 && (
        <div className="navigation-duration-chart" aria-label="Recent screen durations">
          {durations.map((item, index) => (
            <span
              key={`${item.name}:${index}`}
              title={`${item.name}: ${item.duration.toFixed(0)} ms`}
            >
              <i style={{ height: `${Math.max((item.duration / maxDuration) * 100, 4)}%` }} />
            </span>
          ))}
        </div>
      )}
      <div className="navigation-columns">
        <span>Lifecycle</span>
        <span>Transition</span>
        <span>Source</span>
        <span>Action</span>
        <span>Duration</span>
      </div>
      <VirtualizedList
        className="navigation-list"
        empty={
          <div className="empty">
            <div className="empty-icon">→</div>
            <h2>{navigationEvents.length ? 'No matching routes' : 'No navigation events yet'}</h2>
            <p>Route transitions from the connected application will appear here.</p>
          </div>
        }
        getKey={(event) => event.id}
        items={[...filtered].reverse()}
        renderItem={(event) => {
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
              <span>{payload.source}</span>
              <span>{payload.action}</span>
              <span>
                {payload.previousRouteDuration === undefined
                  ? '—'
                  : `${payload.previousRouteDuration.toFixed(0)} ms`}
              </span>
            </button>
          );
        }}
        rowHeight={44}
      />
    </main>
  );
}
