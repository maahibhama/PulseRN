import { reduxEventPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useEffect, useMemo, useState } from 'react';

interface ReduxPanelProps {
  events: DevToolEventEnvelope[];
  selectedEventId?: string;
  onSelect(id: string): void;
}

export function ReduxPanel({ events, selectedEventId, onSelect }: ReduxPanelProps) {
  const reduxEvents = useMemo(() => events.filter((event) => event.category === 'redux'), [events]);
  const [displayedEvents, setDisplayedEvents] = useState(reduxEvents);
  const [paused, setPaused] = useState(false);
  const [clearedAt, setClearedAt] = useState(0);
  const [search, setSearch] = useState('');
  const [storeFilter, setStoreFilter] = useState('ALL');

  useEffect(() => {
    if (!paused) setDisplayedEvents(reduxEvents);
  }, [paused, reduxEvents]);

  const stores = useMemo(() => {
    const values = new Set<string>();
    for (const event of reduxEvents) {
      const parsed = reduxEventPayloadSchema.safeParse(event.payload);
      if (parsed.success) values.add(parsed.data.storeId);
    }
    return ['ALL', ...values];
  }, [reduxEvents]);

  const filtered = displayedEvents.filter((event) => {
    if (event.timestamp <= clearedAt) return false;
    const parsed = reduxEventPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return false;
    if (storeFilter !== 'ALL' && parsed.data.storeId !== storeFilter) return false;
    return parsed.data.actionType.toLowerCase().includes(search.trim().toLowerCase());
  });

  return (
    <main className="timeline redux-panel">
      <div className="panel-header">
        <div>
          <strong>Redux</strong>
          <span>
            {filtered.length} of {reduxEvents.length} actions
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
        <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}>
          {stores.map((store) => (
            <option key={store}>{store}</option>
          ))}
        </select>
        <input
          aria-label="Search Redux actions"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter action types…"
          type="search"
          value={search}
        />
      </div>
      <div className="redux-columns">
        <span>Store</span>
        <span>Action</span>
        <span>Changes</span>
        <span>Reducer</span>
      </div>
      <div className="redux-list">
        {filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">◇</div>
            <h2>{reduxEvents.length ? 'No matching actions' : 'No Redux actions yet'}</h2>
            <p>Dispatch an action from a store with the PulseRN middleware installed.</p>
          </div>
        ) : (
          [...filtered].reverse().map((event) => {
            const parsed = reduxEventPayloadSchema.safeParse(event.payload);
            if (!parsed.success) return null;
            const payload = parsed.data;
            return (
              <button
                className={event.id === selectedEventId ? 'redux-entry selected' : 'redux-entry'}
                key={event.id}
                onClick={() => onSelect(event.id)}
              >
                <span className="store-badge">{payload.storeId}</span>
                <strong title={payload.actionType}>{payload.actionType}</strong>
                <span>{payload.stateDiff?.length ?? '—'}</span>
                <span>{payload.reducerDuration.toFixed(2)} ms</span>
              </button>
            );
          })
        )}
      </div>
    </main>
  );
}
