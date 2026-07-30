import {
  consoleLogPayloadSchema,
  type ConsoleLogLevel,
  type DevToolEventEnvelope,
} from '@pulse-rn/protocol';
import { useEffect, useMemo, useState } from 'react';

interface ConsolePanelProps {
  events: DevToolEventEnvelope[];
  selectedEventId?: string;
  onSelect(id: string): void;
}

const LEVELS: readonly ConsoleLogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

export function ConsolePanel({ events, selectedEventId, onSelect }: ConsolePanelProps) {
  const consoleEvents = useMemo(
    () => events.filter((event) => event.category === 'console'),
    [events],
  );
  const [displayedEvents, setDisplayedEvents] = useState(consoleEvents);
  const [paused, setPaused] = useState(false);
  const [clearedAt, setClearedAt] = useState(0);
  const [search, setSearch] = useState('');
  const [levels, setLevels] = useState<Set<ConsoleLogLevel>>(() => new Set(LEVELS));

  useEffect(() => {
    if (!paused) setDisplayedEvents(consoleEvents);
  }, [consoleEvents, paused]);

  const filtered = useMemo(
    () =>
      displayedEvents.filter((event) => {
        if (event.timestamp <= clearedAt) return false;
        const parsed = consoleLogPayloadSchema.safeParse(event.payload);
        if (!parsed.success || !levels.has(parsed.data.level)) return false;
        return parsed.data.message.toLowerCase().includes(search.trim().toLowerCase());
      }),
    [clearedAt, displayedEvents, levels, search],
  );

  const toggleLevel = (level: ConsoleLogLevel) => {
    setLevels((current) => {
      const next = new Set(current);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  return (
    <main className="timeline console-panel">
      <div className="panel-header console-header">
        <div>
          <strong>Console</strong>
          <span>
            {filtered.length} of {consoleEvents.length} logs
          </span>
        </div>
        <div className="actions">
          <button className={paused ? 'control-active' : ''} onClick={() => setPaused(!paused)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={() => setClearedAt(Date.now())}>Clear</button>
        </div>
      </div>
      <div className="console-toolbar">
        <div className="level-filters">
          {LEVELS.map((level) => (
            <button
              className={levels.has(level) ? `level-filter ${level} enabled` : 'level-filter'}
              key={level}
              onClick={() => toggleLevel(level)}
            >
              {level}
            </button>
          ))}
        </div>
        <input
          aria-label="Search console logs"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter console output…"
          type="search"
          value={search}
        />
      </div>
      <div className="console-columns">
        <span>Time</span>
        <span>Level</span>
        <span>Message</span>
      </div>
      <div className="console-list">
        {filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">&gt;_</div>
            <h2>{consoleEvents.length ? 'No matching logs' : 'No console output yet'}</h2>
            <p>
              {consoleEvents.length
                ? 'Change the level filters or search query.'
                : 'Console calls from the connected React Native app will appear here.'}
            </p>
          </div>
        ) : (
          [...filtered].reverse().map((event) => {
            const parsed = consoleLogPayloadSchema.safeParse(event.payload);
            if (!parsed.success) return null;
            const payload = parsed.data;
            return (
              <div
                className={
                  event.id === selectedEventId ? 'console-entry selected' : 'console-entry'
                }
                key={event.id}
              >
                <button className="console-entry-main" onClick={() => onSelect(event.id)}>
                  <time>{formatTime(event.timestamp)}</time>
                  <span className={`level-badge ${payload.level}`}>{payload.level}</span>
                  <span className="console-message">{payload.message}</span>
                </button>
                <button
                  aria-label="Copy console message"
                  className="copy-row"
                  onClick={() => void navigator.clipboard.writeText(payload.message)}
                >
                  Copy
                </button>
                {payload.arguments.some((argument) => typeof argument === 'object') && (
                  <details className="inline-payload">
                    <summary>Arguments</summary>
                    <pre>{JSON.stringify(payload.arguments, null, 2)}</pre>
                  </details>
                )}
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}
