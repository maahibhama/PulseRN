import {
  nativeLogPayloadSchema,
  type DevToolEventEnvelope,
  type NativeLogLevel,
} from '@pulse-rn/protocol';
import { useEffect, useMemo, useState } from 'react';
import type { NativeLogCaptureStatus } from '../../preload/api.js';

const levels: NativeLogLevel[] = ['verbose', 'debug', 'info', 'warn', 'error', 'fatal'];

export function NativeLogsPanel({
  events,
  selectedEventId,
  onSelect,
}: {
  events: DevToolEventEnvelope[];
  selectedEventId?: string;
  onSelect(id: string): void;
}) {
  const [statuses, setStatuses] = useState<NativeLogCaptureStatus[]>([]);
  const [paused, setPaused] = useState(false);
  const [visibleEvents, setVisibleEvents] = useState(events);
  const [hiddenBefore, setHiddenBefore] = useState(0);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [enabledLevels, setEnabledLevels] = useState<Set<NativeLogLevel>>(
    () => new Set(['info', 'warn', 'error', 'fatal']),
  );

  useEffect(() => {
    void window.pulseRN.getNativeLogStatuses().then(setStatuses);
    return window.pulseRN.onNativeLogStatuses(setStatuses);
  }, []);
  useEffect(() => {
    if (!paused) setVisibleEvents(events);
  }, [events, paused]);

  const rows = useMemo(
    () =>
      visibleEvents.flatMap((event) => {
        if (event.timestamp < hiddenBefore) return [];
        const parsed = nativeLogPayloadSchema.safeParse(event.payload);
        if (!parsed.success || !enabledLevels.has(parsed.data.level)) return [];
        const identity = parsed.data.tag ?? parsed.data.subsystem ?? parsed.data.category ?? '';
        const needle = search.trim().toLowerCase();
        if (
          needle &&
          !`${parsed.data.message} ${identity} ${parsed.data.process}`
            .toLowerCase()
            .includes(needle)
        )
          return [];
        if (source && identity !== source) return [];
        return [{ event, payload: parsed.data, identity }];
      }),
    [enabledLevels, hiddenBefore, search, source, visibleEvents],
  );
  const sources = useMemo(
    () =>
      [
        ...new Set(
          visibleEvents.flatMap((event) => {
            const parsed = nativeLogPayloadSchema.safeParse(event.payload);
            return parsed.success
              ? [parsed.data.tag ?? parsed.data.subsystem ?? parsed.data.category].filter(
                  (value): value is string => Boolean(value),
                )
              : [];
          }),
        ),
      ].sort(),
    [visibleEvents],
  );

  return (
    <main className="timeline native-logs-panel">
      <div className="panel-header native-logs-header">
        <div>
          <h1>Native Logs</h1>
          <p>
            {rows.length} visible · {events.length} persisted
          </p>
        </div>
        <div className="native-log-actions">
          <button onClick={() => setPaused((value) => !value)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={() => setHiddenBefore(Date.now())}>Clear view</button>
        </div>
      </div>

      <section className="native-capture-statuses">
        {statuses.length === 0 ? (
          <p>Connect an iOS or Android app to begin native-log capture.</p>
        ) : (
          statuses.map((status) => (
            <div className={`native-capture-status ${status.state}`} key={status.connectionId}>
              <span className="status" />
              <strong>{status.platform.toUpperCase()}</strong>
              <span>{status.process ?? status.targetId ?? 'Resolving target…'}</span>
              {status.pid && <code>PID {status.pid}</code>}
              <small>
                {status.message ?? (status.state === 'capturing' ? 'Capturing' : status.state)}
              </small>
              {status.droppedLogs > 0 && (
                <small>{status.droppedLogs.toLocaleString()} dropped</small>
              )}
            </div>
          ))
        )}
      </section>

      <div className="native-log-toolbar">
        <div className="native-level-filters">
          {levels.map((level) => (
            <label key={level}>
              <input
                type="checkbox"
                checked={enabledLevels.has(level)}
                onChange={() =>
                  setEnabledLevels((current) => {
                    const next = new Set(current);
                    if (next.has(level)) next.delete(level);
                    else next.add(level);
                    return next;
                  })
                }
              />
              {level}
            </label>
          ))}
        </div>
        <select
          aria-label="Filter native log source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
        >
          <option value="">All tags/subsystems</option>
          {sources.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <input
          aria-label="Search native logs"
          placeholder="Search messages…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="native-log-columns">
        <span>Time</span>
        <span>Level</span>
        <span>Source</span>
        <span>Message</span>
      </div>
      <div className="native-log-list">
        {rows.length === 0 && (
          <div className="empty-state">
            <h2>No matching native logs</h2>
            <p>Logs appear after the connected app writes to its native platform logger.</p>
          </div>
        )}
        {rows.map(({ event, payload, identity }) => (
          <button
            className={`native-log-entry ${payload.level} ${selectedEventId === event.id ? 'selected' : ''}`}
            key={event.id}
            onClick={() => onSelect(event.id)}
          >
            <time>
              {new Date(payload.loggedAt).toLocaleTimeString([], {
                hour12: false,
                fractionalSecondDigits: 3,
              })}
            </time>
            <strong>{payload.level}</strong>
            <code title={identity}>{identity || payload.process}</code>
            <span>{payload.message}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
