import {
  consoleLogPayloadSchema,
  type ConsoleLogLevel,
  type ConsoleLogPayload,
  type DevToolEventEnvelope,
  type JsonValue,
} from '@pulse-rn/protocol';
import { useEffect, useMemo, useState } from 'react';
import { VirtualizedList } from './VirtualizedList.js';

interface ConsolePanelProps {
  events: DevToolEventEnvelope[];
  selectedEventId?: string;
  consoleDroppedEvents?: number;
  onSelect(id: string): void;
}

interface ConsoleRow {
  id: string;
  first: DevToolEventEnvelope;
  last: DevToolEventEnvelope;
  payload: ConsoleLogPayload;
  count: number;
  boundary: boolean;
  source: string;
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

function sourceLabel(payload: ConsoleLogPayload): string {
  if (!payload.source) return 'Unknown source';
  const segments = payload.source.file.split('/');
  return segments.at(-1) || payload.source.file;
}

function sameMessage(row: ConsoleRow, event: DevToolEventEnvelope, payload: ConsoleLogPayload) {
  return (
    row.last.sessionId === event.sessionId &&
    row.payload.level === payload.level &&
    row.payload.message === payload.message &&
    JSON.stringify(row.payload.arguments) === JSON.stringify(payload.arguments) &&
    row.payload.source?.file === payload.source?.file &&
    row.payload.source?.line === payload.source?.line
  );
}

function collapseEvents(events: DevToolEventEnvelope[]): ConsoleRow[] {
  const rows: ConsoleRow[] = [];
  let previousSession: string | undefined;
  for (const event of events) {
    const parsed = consoleLogPayloadSchema.safeParse(event.payload);
    if (!parsed.success) continue;
    const last = rows.at(-1);
    if (last && sameMessage(last, event, parsed.data)) {
      last.last = event;
      last.count += 1;
      continue;
    }
    rows.push({
      id: event.id,
      first: event,
      last: event,
      payload: parsed.data,
      count: 1,
      boundary: previousSession !== undefined && previousSession !== event.sessionId,
      source: sourceLabel(parsed.data),
    });
    previousSession = event.sessionId;
  }
  return rows;
}

function LazyValue({ value, name }: { value: JsonValue; name: string }) {
  const structured = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(false);
  if (!structured) {
    return (
      <div className="lazy-value-leaf">
        <strong>{name}</strong>
        <span>{typeof value === 'string' ? value : JSON.stringify(value)}</span>
      </div>
    );
  }
  return (
    <details
      className="lazy-value"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>
        {name} {Array.isArray(value) ? `Array(${value.length})` : 'Object'}
      </summary>
      {open && (
        <div>
          {Object.entries(value).map(([key, child]) => (
            <LazyValue key={key} name={key} value={child as JsonValue} />
          ))}
        </div>
      )}
    </details>
  );
}

export function ConsolePanel({
  events,
  selectedEventId,
  consoleDroppedEvents = 0,
  onSelect,
}: ConsolePanelProps) {
  const consoleEvents = useMemo(
    () => events.filter((event) => event.category === 'console'),
    [events],
  );
  const [displayedEvents, setDisplayedEvents] = useState(consoleEvents);
  const [paused, setPaused] = useState(false);
  const [clearedAt, setClearedAt] = useState(0);
  const [search, setSearch] = useState('');
  const [levels, setLevels] = useState<Set<ConsoleLogLevel>>(() => new Set(LEVELS));
  const [source, setSource] = useState('');
  const [groupBySource, setGroupBySource] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(500);

  useEffect(() => {
    if (!paused) setDisplayedEvents(consoleEvents);
  }, [consoleEvents, paused]);

  const collapsed = useMemo(
    () =>
      collapseEvents(
        [...displayedEvents]
          .filter((event) => event.timestamp > clearedAt)
          .reverse()
          .slice(-displayLimit),
      ),
    [clearedAt, displayLimit, displayedEvents],
  );
  const sources = useMemo(
    () => [...new Set(collapsed.map((row) => row.source))].sort(),
    [collapsed],
  );
  const filtered = useMemo(() => {
    const searchLines = search
      .toLowerCase()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const result = collapsed.filter(
      (row) =>
        levels.has(row.payload.level) &&
        (!source || row.source === source) &&
        searchLines.every((line) =>
          `${row.payload.message}\n${row.payload.stack ?? ''}`.toLowerCase().includes(line),
        ),
    );
    return groupBySource
      ? [...result].sort(
          (left, right) =>
            left.source.localeCompare(right.source) || left.first.timestamp - right.first.timestamp,
        )
      : result;
  }, [collapsed, groupBySource, levels, search, source]);
  const selected = collapsed.find((row) =>
    [row.first.id, row.last.id].includes(selectedEventId ?? ''),
  );

  const applyPreset = (preset: 'all' | 'problems' | 'verbose') => {
    setLevels(
      new Set(
        preset === 'problems'
          ? ['warn', 'error']
          : preset === 'verbose'
            ? ['log', 'info', 'debug']
            : LEVELS,
      ),
    );
  };

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
            {filtered.length} groups · {consoleEvents.length} persisted logs
          </span>
        </div>
        <div className="actions">
          <button className={paused ? 'control-active' : ''} onClick={() => setPaused(!paused)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={() => setClearedAt(Date.now())}>Clear view</button>
        </div>
      </div>
      {consoleDroppedEvents > 0 && (
        <div className="console-drop-warning">
          {consoleDroppedEvents.toLocaleString()} console events were sampled or dropped by
          connected SDK transports.
        </div>
      )}
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
          <button onClick={() => applyPreset('all')}>All</button>
          <button onClick={() => applyPreset('problems')}>Problems</button>
          <button onClick={() => applyPreset('verbose')}>Verbose</button>
        </div>
        <textarea
          aria-label="Search console logs"
          onChange={(event) => setSearch(event.target.value)}
          placeholder={'Search message and stack\nEach line must match'}
          rows={2}
          value={search}
        />
        <select
          aria-label="Filter console source"
          onChange={(event) => setSource(event.target.value)}
        >
          <option value="">All sources</option>
          {sources.map((entry) => (
            <option key={entry}>{entry}</option>
          ))}
        </select>
        <label>
          <input
            checked={groupBySource}
            onChange={(event) => setGroupBySource(event.target.checked)}
            type="checkbox"
          />
          Group sources
        </label>
        <select
          aria-label="Console display limit"
          onChange={(event) => setDisplayLimit(Number(event.target.value))}
          value={displayLimit}
        >
          <option value={250}>250 logs</option>
          <option value={500}>500 logs</option>
          <option value={1_000}>1,000 logs</option>
          <option value={2_000}>2,000 logs</option>
        </select>
      </div>
      {selected && selected.payload.arguments.some((argument) => typeof argument === 'object') && (
        <section className="console-arguments">
          <header>
            <strong>Structured arguments · decoded on demand</strong>
            <button
              onClick={() =>
                void navigator.clipboard.writeText(
                  JSON.stringify(selected.payload.arguments, null, 2),
                )
              }
            >
              Copy JSON
            </button>
          </header>
          {selected.payload.arguments.map((argument, index) => (
            <LazyValue key={index} name={`Argument ${index + 1}`} value={argument} />
          ))}
        </section>
      )}
      <div className="console-columns">
        <span>Time</span>
        <span>Level</span>
        <span>Message</span>
      </div>
      <VirtualizedList
        className="console-list"
        empty={
          <div className="empty">
            <div className="empty-icon">&gt;_</div>
            <h2>{consoleEvents.length ? 'No matching logs' : 'No console output yet'}</h2>
            <p>
              {consoleEvents.length
                ? 'Change the level, source, or multiline search filters.'
                : 'Console calls from the connected React Native app will appear here.'}
            </p>
          </div>
        }
        getKey={(row) => row.id}
        items={[...filtered].reverse()}
        renderItem={(row) => (
          <div
            className={
              row.first.id === selectedEventId || row.last.id === selectedEventId
                ? 'console-entry selected'
                : 'console-entry'
            }
          >
            {row.boundary && <span className="console-boundary">Session boundary</span>}
            <button className="console-entry-main" onClick={() => onSelect(row.last.id)}>
              <time title={`First ${formatTime(row.first.timestamp)}`}>
                {formatTime(row.last.timestamp)}
              </time>
              <span className={`level-badge ${row.payload.level}`}>{row.payload.level}</span>
              <span className="console-message">
                {groupBySource && <small>{row.source}</small>}
                {row.payload.message}
                {row.count > 1 && <b className="repeat-count">×{row.count}</b>}
                {row.payload.redacted && <b className="redaction-badge">Redacted</b>}
                {row.payload.truncated && <b className="truncation-badge">Truncated</b>}
              </span>
            </button>
            {row.payload.source && (
              <button
                className="console-source"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    `${row.payload.source?.file}:${row.payload.source?.line}:${row.payload.source?.column ?? 0}`,
                  )
                }
              >
                {row.source}:{row.payload.source.line}
              </button>
            )}
            <button
              aria-label="Copy console message"
              className="copy-row"
              onClick={() => void navigator.clipboard.writeText(row.payload.message)}
            >
              Copy
            </button>
          </div>
        )}
        rowHeight={84}
      />
    </main>
  );
}
