import { errorEventPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useEffect, useMemo, useState } from 'react';
import { VirtualizedList } from './VirtualizedList.js';

interface ErrorsPanelProps {
  events: DevToolEventEnvelope[];
  selectedEventId?: string;
  onSelect(id: string): void;
}

interface ErrorGroup {
  fingerprint: string;
  events: DevToolEventEnvelope[];
  latest: DevToolEventEnvelope;
  firstSeen: number;
  lastSeen: number;
  appVersions: string[];
  regression: 'new' | 'recurring' | 'regression';
}

function fallbackFingerprint(payload: ReturnType<typeof errorEventPayloadSchema.parse>): string {
  const normalized = payload.message
    .toLowerCase()
    .replaceAll(/\b\d+(?:\.\d+)?\b/g, '<number>')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return `${payload.name.toLowerCase()}:${normalized}:${payload.frames?.find((frame) => frame.application)?.file ?? ''}`;
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
  const filtered = useMemo(
    () =>
      displayedEvents.filter((event) => {
        if (event.timestamp <= clearedAt) return false;
        const parsed = errorEventPayloadSchema.safeParse(event.payload);
        if (!parsed.success) return false;
        if (source !== 'ALL' && parsed.data.source !== source) return false;
        return (
          !query ||
          parsed.data.message.toLowerCase().includes(query) ||
          parsed.data.name.toLowerCase().includes(query) ||
          parsed.data.stack?.toLowerCase().includes(query) ||
          parsed.data.componentStack?.toLowerCase().includes(query) ||
          parsed.data.frames?.some((frame) => frame.file.toLowerCase().includes(query))
        );
      }),
    [clearedAt, displayedEvents, query, source],
  );
  const groups = useMemo(() => {
    const grouped = new Map<string, DevToolEventEnvelope[]>();
    for (const event of filtered) {
      const parsed = errorEventPayloadSchema.safeParse(event.payload);
      if (!parsed.success) continue;
      const fingerprint = parsed.data.fingerprint ?? fallbackFingerprint(parsed.data);
      grouped.set(fingerprint, [...(grouped.get(fingerprint) ?? []), event]);
    }
    return [...grouped.entries()]
      .map(([fingerprint, occurrences]): ErrorGroup => {
        const sorted = [...occurrences].sort((left, right) => left.timestamp - right.timestamp);
        const versions = [
          ...new Set(
            sorted.flatMap((event) => {
              const parsed = errorEventPayloadSchema.safeParse(event.payload);
              return parsed.success && parsed.data.appVersion ? [parsed.data.appVersion] : [];
            }),
          ),
        ];
        return {
          fingerprint,
          events: sorted,
          latest: sorted.at(-1)!,
          firstSeen: sorted[0]!.timestamp,
          lastSeen: sorted.at(-1)!.timestamp,
          appVersions: versions,
          regression:
            sorted.length === 1 ? 'new' : versions.length > 1 ? 'regression' : 'recurring',
        };
      })
      .sort((left, right) => right.lastSeen - left.lastSeen);
  }, [filtered]);

  return (
    <main className="timeline errors-panel">
      <div className="panel-header">
        <div>
          <strong>Errors</strong>
          <span>
            {groups.length} groups · {filtered.length} of {errorEvents.length} occurrences
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
        <span>Last seen</span>
        <span>Classification</span>
        <span>Error</span>
        <span>Occurrences</span>
        <span>Versions</span>
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
        getKey={(group) => group.fingerprint}
        items={groups}
        renderItem={(group) => {
          const parsed = errorEventPayloadSchema.safeParse(group.latest.payload);
          if (!parsed.success) return null;
          const payload = parsed.data;
          return (
            <button
              className={
                group.events.some((event) => event.id === selectedEventId)
                  ? 'error-entry selected'
                  : 'error-entry'
              }
              key={group.fingerprint}
              onClick={() => onSelect(group.latest.id)}
            >
              <time title={`First seen ${formatTime(group.firstSeen)}`}>
                {formatTime(group.lastSeen)}
              </time>
              <span className={`error-source ${payload.fatal ? 'fatal' : ''}`}>
                {(payload.classification ?? 'application').replaceAll('_', ' ')}
              </span>
              <span className="error-message">
                <strong>{payload.name}</strong>
                <small>{payload.message}</small>
                <small className={`error-regression ${group.regression}`}>{group.regression}</small>
              </span>
              <span>{group.events.length}</span>
              <span>{group.appVersions.join(', ') || 'unknown'}</span>
            </button>
          );
        }}
        rowHeight={56}
      />
    </main>
  );
}
