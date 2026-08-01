import {
  navigationEventPayloadSchema,
  networkEventPayloadSchema,
  performanceEventPayloadSchema,
  reduxEventPayloadSchema,
  type DevToolEventEnvelope,
  type PerformanceEventPayload,
} from '@pulse-rn/protocol';
import { useEffect, useMemo, useState } from 'react';
import { VirtualizedList } from './VirtualizedList.js';

interface PerformancePanelProps {
  events: DevToolEventEnvelope[];
  selectedEventId?: string;
  onSelect(id: string): void;
}

type MetricFilter = 'all' | 'fps' | 'stalls' | 'timing' | 'related';
type TimeRange = 'minute' | 'five-minutes' | 'all';

function formatMetric(payload: PerformanceEventPayload): string {
  if (payload.unit === 'bytes') {
    return payload.value < 1_048_576
      ? `${(payload.value / 1_024).toFixed(1)} KB`
      : `${(payload.value / 1_048_576).toFixed(1)} MB`;
  }
  if (payload.metric === 'capability') return payload.capability?.status ?? 'Unavailable';
  return `${payload.value.toFixed(payload.unit === 'fps' ? 1 : 2)} ${payload.unit}`;
}

function relatedMetric(event: DevToolEventEnvelope): { label: string; value: number } | undefined {
  if (event.category === 'network') {
    const parsed = networkEventPayloadSchema.safeParse(event.payload);
    return parsed.success
      ? { label: `${parsed.data.method} ${parsed.data.url}`, value: parsed.data.duration }
      : undefined;
  }
  if (event.category === 'redux') {
    const parsed = reduxEventPayloadSchema.safeParse(event.payload);
    return parsed.success
      ? { label: parsed.data.actionType, value: parsed.data.reducerDuration }
      : undefined;
  }
  if (event.category === 'navigation') {
    const parsed = navigationEventPayloadSchema.safeParse(event.payload);
    return parsed.success && parsed.data.previousRouteDuration !== undefined
      ? {
          label: parsed.data.previousRoute?.name ?? 'Route',
          value: parsed.data.previousRouteDuration,
        }
      : undefined;
  }
  return undefined;
}

export function PerformancePanel({ events, selectedEventId, onSelect }: PerformancePanelProps) {
  const performanceEvents = useMemo(
    () => events.filter((event) => event.category === 'performance'),
    [events],
  );
  const relatedEvents = useMemo(
    () => events.filter((event) => relatedMetric(event) !== undefined),
    [events],
  );
  const [displayedEvents, setDisplayedEvents] = useState(performanceEvents);
  const [paused, setPaused] = useState(false);
  const [clearedAt, setClearedAt] = useState(0);
  const [filter, setFilter] = useState<MetricFilter>('all');
  const [search, setSearch] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('five-minutes');
  const [fpsThreshold, setFpsThreshold] = useState(50);
  const [stallThreshold, setStallThreshold] = useState(100);
  const [screenThreshold, setScreenThreshold] = useState(1_000);
  const [networkThreshold, setNetworkThreshold] = useState(500);
  const [memoryGrowthThreshold, setMemoryGrowthThreshold] = useState(10);
  const cutoff =
    timeRange === 'all' ? 0 : Date.now() - (timeRange === 'minute' ? 60_000 : 5 * 60_000);

  useEffect(() => {
    if (!paused) setDisplayedEvents(performanceEvents);
  }, [paused, performanceEvents]);

  const metricEvents = displayedEvents.filter((event) => {
    if (event.timestamp <= clearedAt) return false;
    if (event.timestamp < cutoff) return false;
    const parsed = performanceEventPayloadSchema.safeParse(event.payload);
    if (!parsed.success || !parsed.data.name.toLowerCase().includes(search.toLowerCase()))
      return false;
    if (filter === 'fps') return parsed.data.metric === 'js_fps';
    if (filter === 'stalls')
      return ['js_stall', 'long_task', 'event_loop_lag'].includes(parsed.data.metric);
    if (filter === 'timing') {
      return [
        'app_start',
        'screen_mount',
        'screen_interactive',
        'screen_duration',
        'custom_measure',
      ].includes(parsed.data.metric);
    }
    return filter !== 'related';
  });
  const shownEvents =
    filter === 'related'
      ? relatedEvents.filter(
          (event) =>
            event.timestamp > clearedAt &&
            event.timestamp >= cutoff &&
            relatedMetric(event)?.label.toLowerCase().includes(search.toLowerCase()),
        )
      : metricEvents;

  const fpsSamples = performanceEvents
    .flatMap((event) => {
      const parsed = performanceEventPayloadSchema.safeParse(event.payload);
      return parsed.success && parsed.data.metric === 'js_fps' ? [parsed.data.value] : [];
    })
    .slice(-30);
  const latestFps = fpsSamples.at(-1);
  const fpsScale = Math.max(60, ...fpsSamples);
  const stallCount = performanceEvents.filter((event) => {
    const parsed = performanceEventPayloadSchema.safeParse(event.payload);
    return parsed.success && parsed.data.metric === 'js_stall';
  }).length;
  const capabilityGaps = performanceEvents.flatMap((event) => {
    const parsed = performanceEventPayloadSchema.safeParse(event.payload);
    return parsed.success && parsed.data.capability?.status === 'unavailable'
      ? [parsed.data.capability]
      : [];
  });
  const memoryBaseline = performanceEvents.flatMap((event) => {
    const parsed = performanceEventPayloadSchema.safeParse(event.payload);
    return parsed.success && parsed.data.metric === 'memory' ? [parsed.data.value] : [];
  })[0];
  const sessionAverages = useMemo(() => {
    const sessions = new Map<string, number[]>();
    for (const event of performanceEvents) {
      const parsed = performanceEventPayloadSchema.safeParse(event.payload);
      if (!parsed.success || parsed.data.metric === 'capability') continue;
      const values = sessions.get(event.sessionId) ?? [];
      values.push(parsed.data.value);
      sessions.set(event.sessionId, values);
    }
    return [...sessions.entries()].map(([sessionId, values]) => ({
      sessionId,
      average: values.reduce((total, value) => total + value, 0) / values.length,
    }));
  }, [performanceEvents]);

  return (
    <main className="timeline performance-panel">
      <div className="panel-header">
        <div>
          <strong>Performance</strong>
          <span>{performanceEvents.length} metric samples</span>
        </div>
        <div className="actions">
          <button className={paused ? 'control-active' : ''} onClick={() => setPaused(!paused)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={() => setClearedAt(Date.now())}>Clear</button>
        </div>
      </div>
      <div className="performance-summary">
        <div>
          <span>JS FPS</span>
          <strong>{latestFps?.toFixed(1) ?? '—'}</strong>
          <small>approximate</small>
        </div>
        <div>
          <span>JS stalls</span>
          <strong>{stallCount}</strong>
          <small>over configured threshold</small>
        </div>
        <div>
          <span>Related timings</span>
          <strong>{relatedEvents.length}</strong>
          <small>network, Redux, routes</small>
        </div>
        <div>
          <span>Sampling loss</span>
          <strong>
            {`${(
              (1 -
                (performanceEvents
                  .flatMap((event) => {
                    const parsed = performanceEventPayloadSchema.safeParse(event.payload);
                    return parsed.success && parsed.data.sampling
                      ? [parsed.data.sampling.captureRate]
                      : [];
                  })
                  .at(-1) ?? 1)) *
              100
            ).toFixed(1)}%`}
          </strong>
          <small>SDK-reported</small>
        </div>
        <div className="fps-chart" aria-label="Recent approximate JavaScript FPS">
          {fpsSamples.length === 0 ? (
            <small>Waiting for FPS samples…</small>
          ) : (
            fpsSamples.map((fps, index) => (
              <i
                key={index}
                style={{ height: `${Math.max(4, Math.min(100, (fps / fpsScale) * 100))}%` }}
                title={`${fps.toFixed(1)} FPS`}
              />
            ))
          )}
        </div>
      </div>
      {capabilityGaps.length > 0 && (
        <div className="performance-capabilities">
          {capabilityGaps.map((capability) => (
            <span key={capability.name} title={capability.reason}>
              {capability.name.replaceAll('_', ' ')} unavailable
            </span>
          ))}
        </div>
      )}
      {sessionAverages.length > 1 && (
        <div className="performance-baseline">
          Baseline {sessionAverages[0]!.average.toFixed(1)} → current{' '}
          {sessionAverages.at(-1)!.average.toFixed(1)} across matching captured app sessions
        </div>
      )}
      <div className="performance-toolbar">
        {(['all', 'fps', 'stalls', 'timing', 'related'] as const).map((value) => (
          <button
            className={filter === value ? 'active' : ''}
            key={value}
            onClick={() => setFilter(value)}
          >
            {value}
          </button>
        ))}
        <select
          value={timeRange}
          onChange={(event) => setTimeRange(event.target.value as TimeRange)}
        >
          <option value="minute">Last minute</option>
          <option value="five-minutes">Last 5 minutes</option>
          <option value="all">All loaded</option>
        </select>
        <input
          aria-label="Search performance metrics"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter metrics…"
          type="search"
          value={search}
        />
      </div>
      <details className="performance-thresholds">
        <summary>Thresholds</summary>
        <label>
          JS FPS below
          <input
            min="1"
            onChange={(event) => setFpsThreshold(Number(event.target.value))}
            type="number"
            value={fpsThreshold}
          />
        </label>
        <label>
          Stall ms
          <input
            min="1"
            onChange={(event) => setStallThreshold(Number(event.target.value))}
            type="number"
            value={stallThreshold}
          />
        </label>
        <label>
          Slow screen ms
          <input
            min="1"
            onChange={(event) => setScreenThreshold(Number(event.target.value))}
            type="number"
            value={screenThreshold}
          />
        </label>
        <label>
          Network ms
          <input
            min="1"
            onChange={(event) => setNetworkThreshold(Number(event.target.value))}
            type="number"
            value={networkThreshold}
          />
        </label>
        <label>
          Memory growth MiB
          <input
            min="1"
            onChange={(event) => setMemoryGrowthThreshold(Number(event.target.value))}
            type="number"
            value={memoryGrowthThreshold}
          />
        </label>
      </details>
      <div className="performance-columns">
        <span>Metric</span>
        <span>Name</span>
        <span>Value</span>
        <span>Quality</span>
      </div>
      <VirtualizedList
        className="performance-list"
        empty={
          <div className="empty">
            <div className="empty-icon">⌁</div>
            <h2>No performance data yet</h2>
            <p>Enable performance capture or run the example performance demo.</p>
          </div>
        }
        getKey={(event) => event.id}
        items={[...shownEvents].reverse()}
        renderItem={(event) => {
          const parsed = performanceEventPayloadSchema.safeParse(event.payload);
          const related = relatedMetric(event);
          const metric = parsed.success ? parsed.data.metric : event.category;
          const name = parsed.success ? parsed.data.name : (related?.label ?? event.type);
          const value = parsed.success
            ? formatMetric(parsed.data)
            : `${related?.value.toFixed(2) ?? '—'} ms`;
          const thresholdExceeded = parsed.success
            ? (parsed.data.metric === 'js_fps' && parsed.data.value < fpsThreshold) ||
              (['js_stall', 'event_loop_lag', 'long_task'].includes(parsed.data.metric) &&
                parsed.data.value >= stallThreshold) ||
              (parsed.data.metric === 'screen_duration' && parsed.data.value >= screenThreshold) ||
              (parsed.data.metric === 'memory' &&
                memoryBaseline !== undefined &&
                parsed.data.value - memoryBaseline >= memoryGrowthThreshold * 1_048_576)
            : event.category === 'network' && (related?.value ?? 0) >= networkThreshold;
          return (
            <button
              className={`${event.id === selectedEventId ? 'performance-entry selected' : 'performance-entry'} ${thresholdExceeded ? 'threshold-exceeded' : ''}`}
              key={event.id}
              onClick={() => onSelect(event.id)}
            >
              <span className="metric-badge">{metric}</span>
              <strong title={name}>{name}</strong>
              <span>{value}</span>
              <span>
                {parsed.success && parsed.data.approximate ? 'JS · Approx.' : 'Measured'}
                {thresholdExceeded ? ' · Threshold' : ''}
              </span>
            </button>
          );
        }}
        rowHeight={44}
      />
    </main>
  );
}
