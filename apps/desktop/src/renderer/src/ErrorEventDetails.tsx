import { errorEventPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';

export function ErrorEventDetails({ event }: { event: DevToolEventEnvelope }) {
  const parsed = errorEventPayloadSchema.safeParse(event.payload);
  if (!parsed.success) return <p className="invalid-payload">Invalid error payload.</p>;
  const payload = parsed.data;

  return (
    <>
      <div className="detail-grid error-summary">
        <span>Source</span>
        <strong>{payload.source.replaceAll('_', ' ')}</strong>
        <span>Fatal</span>
        <strong>{payload.fatal ? 'Yes' : 'No'}</strong>
        <span>Screen</span>
        <strong>{payload.screen ?? 'Unknown'}</strong>
        <span>Context</span>
        <strong>{payload.context.length} previous events</strong>
      </div>
      <h3>{payload.name}</h3>
      <p className="error-detail-message">{payload.message}</p>
      {payload.stack && (
        <>
          <h3>Stack trace</h3>
          <pre className="stack-trace">{payload.stack}</pre>
        </>
      )}
      {payload.componentStack && (
        <>
          <h3>React component stack</h3>
          <pre className="stack-trace">{payload.componentStack}</pre>
        </>
      )}
      <h3>Previous timeline context</h3>
      <div className="error-context">
        {payload.context.length === 0 ? (
          <p>No earlier events were available.</p>
        ) : (
          payload.context.map((contextEvent) => (
            <div key={contextEvent.id}>
              <span>{contextEvent.category}</span>
              <strong>{contextEvent.type}</strong>
              <small>{contextEvent.summary}</small>
            </div>
          ))
        )}
      </div>
      {payload.metadata !== undefined && (
        <>
          <h3>Metadata</h3>
          <pre>{JSON.stringify(payload.metadata, null, 2)}</pre>
        </>
      )}
    </>
  );
}
