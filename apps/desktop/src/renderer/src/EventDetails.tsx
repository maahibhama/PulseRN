import { consoleLogPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { NetworkEventDetails } from './NetworkEventDetails.js';

interface EventDetailsProps {
  event?: DevToolEventEnvelope;
}

function StandardDetails({ event }: { event: DevToolEventEnvelope }) {
  const consolePayload =
    event.category === 'console' ? consoleLogPayloadSchema.safeParse(event.payload) : undefined;
  return (
    <>
      {consolePayload?.success && consolePayload.data.source && (
        <>
          <h3>Source</h3>
          <button
            className="source-link"
            title="Copy source location"
            onClick={() => {
              const source = consolePayload.data.source;
              if (!source) return;
              void navigator.clipboard.writeText(
                `${source.file}:${source.line}:${source.column ?? 0}`,
              );
            }}
          >
            {consolePayload.data.source.file}:{consolePayload.data.source.line}:
            {consolePayload.data.source.column ?? 0}
          </button>
        </>
      )}
      <h3>Payload</h3>
      <pre>{JSON.stringify(event.payload, null, 2)}</pre>
      {consolePayload?.success && consolePayload.data.stack && (
        <>
          <h3>Stack trace</h3>
          <pre className="stack-trace">{consolePayload.data.stack}</pre>
        </>
      )}
    </>
  );
}

export function EventDetails({ event }: EventDetailsProps) {
  return (
    <aside className="details">
      <div className="panel-header">
        <strong>Event details</strong>
        {event && (
          <button
            className="copy-detail"
            onClick={() =>
              void navigator.clipboard.writeText(JSON.stringify(event.payload, null, 2))
            }
          >
            Copy payload
          </button>
        )}
      </div>
      {event ? (
        <div className="detail-content">
          <div className="detail-grid">
            <span>Type</span>
            <strong>{event.type}</strong>
            <span>Category</span>
            <strong>{event.category}</strong>
            <span>Sequence</span>
            <strong>{event.sequence}</strong>
            <span>Session</span>
            <strong>{event.sessionId}</strong>
          </div>
          {event.category === 'network' ? (
            <NetworkEventDetails event={event} />
          ) : (
            <StandardDetails event={event} />
          )}
        </div>
      ) : (
        <div className="details-empty">
          Select an event to inspect its validated envelope and payload.
        </div>
      )}
    </aside>
  );
}
