import { networkEventPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useEffect, useMemo, useState } from 'react';

interface NetworkPanelProps {
  events: DevToolEventEnvelope[];
  selectedEventId?: string;
  onSelect(id: string): void;
}

type StatusFilter = 'all' | 'success' | 'failed';

function formatSize(size?: number): string {
  if (size === undefined) return '—';
  if (size < 1_024) return `${size} B`;
  if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(1)} KB`;
  return `${(size / (1_024 * 1_024)).toFixed(1)} MB`;
}

export function NetworkPanel({ events, selectedEventId, onSelect }: NetworkPanelProps) {
  const networkEvents = useMemo(
    () => events.filter((event) => event.category === 'network'),
    [events],
  );
  const [displayedEvents, setDisplayedEvents] = useState(networkEvents);
  const [paused, setPaused] = useState(false);
  const [clearedAt, setClearedAt] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [methodFilter, setMethodFilter] = useState('ALL');

  useEffect(() => {
    if (!paused) setDisplayedEvents(networkEvents);
  }, [networkEvents, paused]);

  const methods = useMemo(() => {
    const values = new Set<string>();
    for (const event of networkEvents) {
      const parsed = networkEventPayloadSchema.safeParse(event.payload);
      if (parsed.success) values.add(parsed.data.method);
    }
    return ['ALL', ...values];
  }, [networkEvents]);

  const filtered = useMemo(
    () =>
      displayedEvents.filter((event) => {
        if (event.timestamp <= clearedAt) return false;
        const parsed = networkEventPayloadSchema.safeParse(event.payload);
        if (!parsed.success) return false;
        const payload = parsed.data;
        const failed = Boolean(payload.error) || (payload.status ?? 0) >= 400;
        if (statusFilter === 'failed' && !failed) return false;
        if (statusFilter === 'success' && failed) return false;
        if (methodFilter !== 'ALL' && payload.method !== methodFilter) return false;
        return payload.url.toLowerCase().includes(search.trim().toLowerCase());
      }),
    [clearedAt, displayedEvents, methodFilter, search, statusFilter],
  );

  return (
    <main className="timeline network-panel">
      <div className="panel-header">
        <div>
          <strong>Network</strong>
          <span>
            {filtered.length} of {networkEvents.length} requests
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
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
        >
          <option value="all">All statuses</option>
          <option value="success">Successful</option>
          <option value="failed">Failed</option>
        </select>
        <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
          {methods.map((method) => (
            <option value={method} key={method}>
              {method}
            </option>
          ))}
        </select>
        <input
          aria-label="Search network requests"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter URLs…"
          type="search"
          value={search}
        />
      </div>
      <div className="network-columns">
        <span>Status</span>
        <span>Method</span>
        <span>URL</span>
        <span>Duration</span>
        <span>Size</span>
      </div>
      <div className="network-list">
        {filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">⇄</div>
            <h2>{networkEvents.length ? 'No matching requests' : 'No network traffic yet'}</h2>
            <p>Fetch and XMLHttpRequest activity from the connected app will appear here.</p>
          </div>
        ) : (
          [...filtered].reverse().map((event) => {
            const parsed = networkEventPayloadSchema.safeParse(event.payload);
            if (!parsed.success) return null;
            const payload = parsed.data;
            const failed = Boolean(payload.error) || (payload.status ?? 0) >= 400;
            return (
              <button
                className={`${event.id === selectedEventId ? 'network-entry selected' : 'network-entry'} ${failed ? 'failed' : ''}`}
                key={event.id}
                onClick={() => onSelect(event.id)}
              >
                <span className={`network-status ${failed ? 'failed' : ''}`}>
                  {payload.error ? 'ERR' : (payload.status ?? '—')}
                </span>
                <span className={`method-badge ${payload.method.toLowerCase()}`}>
                  {payload.method}
                </span>
                <span className="network-url" title={payload.url}>
                  {payload.url}
                </span>
                <span className="network-duration">{payload.duration.toFixed(0)} ms</span>
                <span className="network-size">{formatSize(payload.responseBody?.size)}</span>
              </button>
            );
          })
        )}
      </div>
    </main>
  );
}
