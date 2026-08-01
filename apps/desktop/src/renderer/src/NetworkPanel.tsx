import {
  networkEventPayloadSchema,
  networkLifecycleEventPayloadSchema,
  type DevToolEventEnvelope,
  type NetworkEventPayload,
} from '@pulse-rn/protocol';
import { useEffect, useMemo, useState } from 'react';
import { VirtualizedList } from './VirtualizedList.js';

interface NetworkPanelProps {
  events: DevToolEventEnvelope[];
  selectedEventId?: string;
  sessionId?: string;
  onSelect(id: string): void;
}

interface NetworkRow {
  requestId: string;
  event: DevToolEventEnvelope;
  payload?: NetworkEventPayload;
  method: string;
  url: string;
  startedAt: number;
  endedAt?: number;
  status?: number;
  error?: string;
  progress?: { loaded: number; total?: number };
  redirects: { from: string; to: string }[];
  timingAccuracy: 'measured' | 'approximate';
}

type StatusFilter = 'all' | 'success' | 'failed' | 'in-flight';

function formatSize(size?: number): string {
  if (size === undefined) return '—';
  if (size < 1_024) return `${size} B`;
  if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(1)} KB`;
  return `${(size / (1_024 * 1_024)).toFixed(1)} MB`;
}

function buildRows(events: DevToolEventEnvelope[]): NetworkRow[] {
  const rows = new Map<string, NetworkRow>();
  for (const event of [...events].reverse()) {
    const completed = networkEventPayloadSchema.safeParse(event.payload);
    if (completed.success) {
      const payload = completed.data;
      const current = rows.get(payload.requestId);
      rows.set(payload.requestId, {
        requestId: payload.requestId,
        event,
        payload,
        method: payload.method,
        url: payload.url,
        startedAt: payload.startedAt,
        endedAt: payload.endedAt,
        status: payload.status,
        error: payload.error?.message,
        progress: current?.progress,
        redirects:
          payload.redirectChain?.map((redirect) => ({
            from: redirect.from,
            to: redirect.to,
          })) ??
          current?.redirects ??
          [],
        timingAccuracy: payload.timingAccuracy ?? 'approximate',
      });
      continue;
    }
    const lifecycle = networkLifecycleEventPayloadSchema.safeParse(event.payload);
    if (!lifecycle.success) continue;
    const payload = lifecycle.data;
    const current = rows.get(payload.requestId) ?? {
      requestId: payload.requestId,
      event,
      method: payload.method,
      url: payload.url,
      startedAt: payload.startedAt,
      redirects: [],
      timingAccuracy: payload.timingAccuracy,
    };
    current.event = event;
    current.status = payload.status ?? current.status;
    current.timingAccuracy = payload.timingAccuracy;
    if (payload.phase === 'progress') {
      current.progress = {
        loaded: payload.loadedBytes ?? 0,
        ...(payload.totalBytes === undefined ? {} : { total: payload.totalBytes }),
      };
    }
    if (payload.phase === 'redirect' && payload.redirectFrom && payload.redirectTo) {
      current.redirects.push({ from: payload.redirectFrom, to: payload.redirectTo });
    }
    if (payload.phase === 'complete' || payload.phase === 'failure') {
      current.endedAt = payload.timestamp;
      current.error = payload.error?.message;
    }
    rows.set(payload.requestId, current);
  }
  return [...rows.values()].sort((left, right) => right.startedAt - left.startedAt);
}

export function NetworkPanel({ events, selectedEventId, sessionId, onSelect }: NetworkPanelProps) {
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
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!paused) setDisplayedEvents(networkEvents);
  }, [networkEvents, paused]);

  const rows = useMemo(
    () => buildRows(displayedEvents.filter((event) => event.timestamp > clearedAt)),
    [clearedAt, displayedEvents],
  );
  const methods = useMemo(() => ['ALL', ...new Set(rows.map((row) => row.method))], [rows]);
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const failed = Boolean(row.error) || (row.status ?? 0) >= 400;
        const inFlight = row.endedAt === undefined;
        if (statusFilter === 'failed' && !failed) return false;
        if (statusFilter === 'success' && (failed || inFlight)) return false;
        if (statusFilter === 'in-flight' && !inFlight) return false;
        if (methodFilter !== 'ALL' && row.method !== methodFilter) return false;
        const haystack = JSON.stringify({
          url: row.url,
          headers: row.payload?.requestHeaders,
          query: row.payload?.query,
        }).toLowerCase();
        return haystack.includes(search.trim().toLowerCase());
      }),
    [methodFilter, rows, search, statusFilter],
  );
  const rangeStart = Math.min(...filtered.map((row) => row.startedAt), Date.now());
  const rangeEnd = Math.max(...filtered.map((row) => row.endedAt ?? Date.now()), rangeStart + 1);

  return (
    <main className="timeline network-panel">
      <div className="panel-header">
        <div>
          <strong>Network</strong>
          <span>
            {filtered.length} of {rows.length} requests ·{' '}
            {rows.filter((row) => row.endedAt === undefined).length} in flight
          </span>
        </div>
        <div className="actions">
          <button
            onClick={() => {
              void window.pulseRN
                .exportNetworkHar(sessionId)
                .then((result) =>
                  setMessage(
                    result.canceled
                      ? 'HAR export cancelled.'
                      : `${result.entries} requests exported.`,
                  ),
                )
                .catch((cause: unknown) =>
                  setMessage(cause instanceof Error ? cause.message : 'HAR export failed.'),
                );
            }}
          >
            Export sanitized HAR
          </button>
          <button className={paused ? 'control-active' : ''} onClick={() => setPaused(!paused)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={() => setClearedAt(Date.now())}>Clear view</button>
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
          <option value="in-flight">In flight</option>
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
          placeholder="Search URL, headers, and query…"
          type="search"
          value={search}
        />
        {message && <span>{message}</span>}
      </div>
      <div className="network-columns network-waterfall-columns">
        <span>Status</span>
        <span>Method</span>
        <span>URL</span>
        <span>Duration</span>
        <span>Size</span>
        <span>Waterfall</span>
      </div>
      <VirtualizedList
        className="network-list"
        empty={
          <div className="empty">
            <div className="empty-icon">⇄</div>
            <h2>{rows.length ? 'No matching requests' : 'No network traffic yet'}</h2>
            <p>Fetch, XMLHttpRequest, and Axios lifecycle events will appear here.</p>
          </div>
        }
        getKey={(row) => row.requestId}
        items={filtered}
        renderItem={(row) => {
          const failed = Boolean(row.error) || (row.status ?? 0) >= 400;
          const duration = (row.endedAt ?? Date.now()) - row.startedAt;
          const left = ((row.startedAt - rangeStart) / (rangeEnd - rangeStart)) * 100;
          const width = Math.max((duration / (rangeEnd - rangeStart)) * 100, 1);
          return (
            <button
              className={`${row.event.id === selectedEventId ? 'network-entry selected' : 'network-entry'} ${failed ? 'failed' : ''}`}
              onClick={() => onSelect(row.event.id)}
            >
              <span className={`network-status ${failed ? 'failed' : ''}`}>
                {row.endedAt === undefined ? 'LIVE' : row.error ? 'ERR' : (row.status ?? '—')}
              </span>
              <span className={`method-badge ${row.method.toLowerCase()}`}>{row.method}</span>
              <span className="network-url" title={row.url}>
                {row.url}
                {row.redirects.length > 0 && <small>{row.redirects.length} redirect(s)</small>}
                {row.progress && (
                  <small>
                    {formatSize(row.progress.loaded)}
                    {row.progress.total ? ` / ${formatSize(row.progress.total)}` : ''}
                  </small>
                )}
              </span>
              <span className="network-duration">
                {row.timingAccuracy === 'approximate' ? '~' : ''}
                {duration.toFixed(0)} ms
              </span>
              <span className="network-size">{formatSize(row.payload?.responseBody?.size)}</span>
              <span className="waterfall-track">
                <i
                  className={row.endedAt === undefined ? 'in-flight' : failed ? 'failed' : ''}
                  style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                />
              </span>
            </button>
          );
        }}
        rowHeight={48}
      />
    </main>
  );
}
