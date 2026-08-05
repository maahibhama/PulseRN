import {
  animationEventPayloadSchema,
  workletEventPayloadSchema,
  type AnimationEventPayload,
  type DevToolEventEnvelope,
  type WorkletEventPayload,
} from '@pulse-rn/protocol';
import { useMemo, useState } from 'react';
import { VirtualizedList } from './VirtualizedList.js';

export function AnimationsWorkletsPanel({
  events,
  selectedEventId,
  onSelect,
}: {
  events: DevToolEventEnvelope[];
  selectedEventId?: string;
  onSelect(id: string): void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'animation' | 'worklet' | 'problems'>('all');
  type InspectorItem =
    | { event: DevToolEventEnvelope; kind: 'animation'; payload: AnimationEventPayload }
    | { event: DevToolEventEnvelope; kind: 'worklet'; payload: WorkletEventPayload };
  const parsed = useMemo(() => {
    const result: InspectorItem[] = [];
    for (const event of events) {
      if (event.category === 'animation') {
        const payload = animationEventPayloadSchema.safeParse(event.payload);
        if (payload.success) result.push({ event, kind: 'animation', payload: payload.data });
      }
      if (event.category === 'worklet') {
        const payload = workletEventPayloadSchema.safeParse(event.payload);
        if (payload.success) result.push({ event, kind: 'worklet', payload: payload.data });
      }
    }
    return result;
  }, [events]);
  const shown = parsed.filter((item) => {
    const text = JSON.stringify(item.payload).toLowerCase();
    if (!text.includes(query.toLowerCase())) return false;
    if (kind === 'animation' || kind === 'worklet') return item.kind === kind;
    if (kind === 'problems') {
      return (
        item.event.type.endsWith('failed') ||
        (item.kind === 'animation' && (item.payload.frame?.lateFrames ?? 0) > 0) ||
        (item.kind === 'worklet' &&
          ((item.payload.queueWaitMs ?? 0) > 16 || (item.payload.durationMs ?? 0) > 16))
      );
    }
    return true;
  });
  const runtimes = useMemo(() => {
    const entries = new Map<string, { label: string; kind: string; events: number }>();
    for (const item of parsed) {
      const id =
        item.kind === 'animation'
          ? (item.payload.runtimeId ?? 'ui-runtime')
          : item.payload.runtimeId;
      const current = entries.get(id);
      entries.set(id, {
        label:
          item.kind === 'worklet'
            ? (item.payload.runtimeName ?? current?.label ?? id)
            : (current?.label ?? (id === 'ui-runtime' ? 'Reanimated UI' : id)),
        kind: item.kind === 'worklet' ? item.payload.runtimeKind : 'ui',
        events: (current?.events ?? 0) + 1,
      });
    }
    return [...entries.entries()].map(([id, value]) => ({ id, ...value }));
  }, [parsed]);
  const animationCount = parsed.filter(
    (item) => item.kind === 'animation' && item.payload.phase === 'created',
  ).length;
  const failures = parsed.filter((item) => item.event.type.endsWith('failed')).length;
  const lateFrames = parsed.reduce(
    (total, item) =>
      total + (item.kind === 'animation' ? (item.payload.frame?.lateFrames ?? 0) : 0),
    0,
  );

  return (
    <main className="timeline animation-worklets-panel">
      <div className="panel-header">
        <div>
          <strong>Animations &amp; Worklets</strong>
          <span>{parsed.length} correlated records</span>
        </div>
      </div>
      <div className="animation-summary">
        <div>
          <span>Animations</span>
          <strong>{animationCount}</strong>
        </div>
        <div>
          <span>Runtimes</span>
          <strong>{runtimes.length}</strong>
        </div>
        <div>
          <span>Late frames</span>
          <strong>{lateFrames}</strong>
        </div>
        <div>
          <span>Failures</span>
          <strong>{failures}</strong>
        </div>
      </div>
      <div className="runtime-lanes">
        {runtimes.length === 0 ? (
          <small>Waiting for runtime capability events…</small>
        ) : (
          runtimes.map((runtime) => (
            <div key={runtime.id}>
              <i className={`runtime-dot ${runtime.kind}`} />
              <strong>{runtime.label}</strong>
              <small>{runtime.kind}</small>
              <span>{runtime.events} events</span>
            </div>
          ))
        )}
      </div>
      <div className="inspector-controls">
        <div className="animation-filter">
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="all">All activity</option>
            <option value="animation">Animations</option>
            <option value="worklet">Worklets</option>
            <option value="problems">Problems</option>
          </select>
        </div>
        <div className="animation-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search animations and worklets"
            placeholder="Component, property, runtime, worklet…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery('')}>
              ×
            </button>
          )}
        </div>
        <span className="animation-result-count">{shown.length} shown</span>
      </div>
      <VirtualizedList
        className="event-list"
        empty={<div className="empty-state">No matching animation or worklet activity.</div>}
        items={shown}
        getKey={(item) => item.event.id}
        rowHeight={70}
        renderItem={(item) => {
          const title =
            item.kind === 'animation'
              ? `${item.payload.animationType} · ${item.payload.phase}`
              : `${item.payload.workletName ?? item.payload.runtimeName ?? item.payload.runtimeId} · ${item.payload.operation}`;
          const subtitle =
            item.kind === 'animation'
              ? `${item.payload.component ?? 'Unattributed component'} ${item.payload.properties?.join(', ') ?? ''}`
              : `${item.payload.originRuntime ?? item.payload.runtimeKind} → ${item.payload.destinationRuntime ?? item.payload.runtimeKind}`;
          const timing =
            item.kind === 'animation'
              ? item.payload.durationMs
              : (item.payload.durationMs ?? item.payload.queueWaitMs);
          return (
            <button
              className={selectedEventId === item.event.id ? 'event selected' : 'event'}
              onClick={() => onSelect(item.event.id)}
            >
              <span className={`category ${item.kind}`}>{item.kind}</span>
              <strong>{title}</strong>
              <small>{subtitle}</small>
              <time>{timing === undefined ? '—' : `${timing.toFixed(2)} ms`}</time>
            </button>
          );
        }}
      />
    </main>
  );
}
