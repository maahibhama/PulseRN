import { errorEventPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useEffect, useMemo, useState } from 'react';
import { VirtualizedList } from './VirtualizedList.js';

interface ErrorsPanelProps {
  events: DevToolEventEnvelope[];
  selectedEventId?: string;
  onSelect(id: string): void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

export function ErrorsPanel({ events, selectedEventId, onSelect }: ErrorsPanelProps) {
  const errorEvents = useMemo(() => events.filter((event) => event.category === 'error'), [events]);
  const [displayedEvents, setDisplayedEvents] = useState(errorEvents);
  const [paused, setPaused] = useState(false);
  const [clearedAt, setClearedAt] = useState(0);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('ALL');

  useEffect(() => {
    if (!paused) setDisplayedEvents(errorEvents);
  }, [errorEvents, paused]);

  const sources = useMemo(() => {
    const values = new Set<string>();
    for (const event of errorEvents) {
      const parsed = errorEventPayloadSchema.safeParse(event.payload);
      if (parsed.success) values.add(parsed.data.source);
    }
    return ['ALL', ...values];
  }, [errorEvents]);

  const query = search.trim().toLowerCase();
  const filtered = displayedEvents.filter((event) => {
    if (event.timestamp <= clearedAt) return false;
    const parsed = errorEventPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return false;
    if (source !== 'ALL' && parsed.data.source !== source) return false;
    return (
      !query ||
      parsed.data.message.toLowerCase().includes(query) ||
      parsed.data.name.toLowerCase().includes(query) ||
      parsed.data.stack?.toLowerCase().includes(query)
    );
  });

  return (
    <main className="timeline errors-panel">
      <div className="panel-header">
        <div>
          <strong>Errors</strong>
          <span>
            {filtered.length} of {errorEvents.length} captured
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
        <select value={source} onChange={(event) => setSource(event.target.value)}>
          {sources.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <input
          aria-label="Search errors"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search messages and stacks…"
          type="search"
          value={search}
        />
      </div>
      <div className="error-columns">
        <span>Time</span>
        <span>Source</span>
        <span>Error</span>
        <span>Context</span>
      </div>
      <VirtualizedList
        className="error-list"
        empty={
          <div className="empty">
            <div className="empty-icon">△</div>
            <h2>{errorEvents.length ? 'No matching errors' : 'No errors captured'}</h2>
            <p>
              Uncaught errors, rejected promises, network failures, and error boundaries appear
              here.
            </p>
          </div>
        }
        getKey={(event) => event.id}
        items={[...filtered].reverse()}
        renderItem={(event) => {
          const parsed = errorEventPayloadSchema.safeParse(event.payload);
          if (!parsed.success) return null;
          const payload = parsed.data;
          return (
            <button
              className={event.id === selectedEventId ? 'error-entry selected' : 'error-entry'}
              key={event.id}
              onClick={() => onSelect(event.id)}
            >
              <time>{formatTime(event.timestamp)}</time>
              <span className={`error-source ${payload.fatal ? 'fatal' : ''}`}>
                {payload.source.replaceAll('_', ' ')}
              </span>
              <span className="error-message">
                <strong>{payload.name}</strong>
                <small>{payload.message}</small>
              </span>
              <span>{payload.context.length}</span>
            </button>
          );
        }}
        rowHeight={56}
      />
    </main>
  );
}
