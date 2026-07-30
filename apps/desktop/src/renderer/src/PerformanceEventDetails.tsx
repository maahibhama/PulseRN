import { performanceEventPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';

export function PerformanceEventDetails({ event }: { event: DevToolEventEnvelope }) {
  const parsed = performanceEventPayloadSchema.safeParse(event.payload);
  if (!parsed.success) return <p className="network-error">Invalid performance event payload.</p>;
  const payload = parsed.data;
  return (
    <>
      <div className="network-summary">
        <div className="performance-value">
          <span>{payload.metric.replaceAll('_', ' ')}</span>
          <strong>
            {payload.value.toFixed(2)} {payload.unit}
          </strong>
          {payload.approximate && <small>Approximate JavaScript-derived metric</small>}
        </div>
        <div className="timing-grid">
          <span>Name</span>
          <strong>{payload.name}</strong>
          <span>Started</span>
          <strong>{payload.startedAt?.toFixed(2) ?? 'Not available'}</strong>
          <span>Ended</span>
          <strong>{payload.endedAt?.toFixed(2) ?? 'Not available'}</strong>
        </div>
      </div>
      {payload.metadata !== undefined && (
        <>
          <h3>Metadata</h3>
          <pre>{JSON.stringify(payload.metadata, null, 2)}</pre>
        </>
      )}
      <h3>Metric payload</h3>
      <pre>{JSON.stringify(payload, null, 2)}</pre>
    </>
  );
}
