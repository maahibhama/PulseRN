import { navigationEventPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';

export function NavigationEventDetails({ event }: { event: DevToolEventEnvelope }) {
  const parsed = navigationEventPayloadSchema.safeParse(event.payload);
  if (!parsed.success) return <p className="network-error">Invalid navigation event payload.</p>;
  const payload = parsed.data;
  return (
    <>
      <div className="network-summary">
        <div className="route-transition">
          <div>
            <span>From</span>
            <strong>{payload.previousRoute?.name ?? 'Application start'}</strong>
          </div>
          <b>→</b>
          <div>
            <span>To</span>
            <strong>{payload.currentRoute?.name ?? 'Unknown route'}</strong>
          </div>
        </div>
        <div className="timing-grid">
          <span>Navigator</span>
          <strong>{payload.navigatorId}</strong>
          <span>Source</span>
          <strong>{payload.source}</strong>
          <span>Lifecycle</span>
          <strong>{payload.lifecycle}</strong>
          <span>Action</span>
          <strong>{payload.action}</strong>
          <span>Previous time</span>
          <strong>
            {payload.previousRouteDuration === undefined
              ? 'Not available'
              : `${payload.previousRouteDuration.toFixed(0)} ms`}
          </strong>
        </div>
      </div>
      {payload.currentRoute?.params !== undefined && (
        <>
          <h3>Current route parameters</h3>
          <pre>{JSON.stringify(payload.currentRoute.params, null, 2)}</pre>
        </>
      )}
      <h3>Route payload</h3>
      <pre>{JSON.stringify(payload, null, 2)}</pre>
    </>
  );
}
