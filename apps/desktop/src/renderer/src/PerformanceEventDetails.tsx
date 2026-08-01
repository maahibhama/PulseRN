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
          <span>Provenance</span>
          <strong>{payload.provenance ?? 'Not reported'}</strong>
          <span>Sampling interval</span>
          <strong>{payload.sampling ? `${payload.sampling.intervalMs} ms` : 'Not sampled'}</strong>
          <span>Sampling loss</span>
          <strong>
            {payload.sampling
              ? `${payload.sampling.lostSamples} (${((1 - payload.sampling.captureRate) * 100).toFixed(1)}%)`
              : 'Not sampled'}
          </strong>
        </div>
      </div>
      {payload.metadata !== undefined && (
        <>
          <h3>Metadata</h3>
          <pre>{JSON.stringify(payload.metadata, null, 2)}</pre>
        </>
      )}
      {payload.capability && (
        <div className="performance-capability-detail">
          {payload.capability.name.replaceAll('_', ' ')}: {payload.capability.status}
          {payload.capability.reason && <small>{payload.capability.reason}</small>}
        </div>
      )}
      <h3>Metric payload</h3>
      <pre>{JSON.stringify(payload, null, 2)}</pre>
    </>
  );
}
