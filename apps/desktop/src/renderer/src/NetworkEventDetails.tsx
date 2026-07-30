import { networkEventPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useState } from 'react';

interface NetworkEventDetailsProps {
  event: DevToolEventEnvelope;
}

type DetailTab = 'headers' | 'request' | 'response' | 'timing';
const TABS: readonly DetailTab[] = ['headers', 'request', 'response', 'timing'];

function DataBlock({ value, empty }: { value: unknown; empty: string }) {
  if (value === undefined || value === null) return <div className="tab-empty">{empty}</div>;
  return <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>;
}

export function NetworkEventDetails({ event }: NetworkEventDetailsProps) {
  const [tab, setTab] = useState<DetailTab>('headers');
  const parsed = networkEventPayloadSchema.safeParse(event.payload);
  if (!parsed.success) return <div className="details-empty">Invalid network payload.</div>;
  const payload = parsed.data;

  return (
    <>
      <div className="network-summary">
        <div className="request-line">
          <span className="method-badge">{payload.method}</span>
          <strong>{payload.status ?? 'ERR'}</strong>
          <span>{payload.duration.toFixed(0)} ms</span>
        </div>
        <div className="detail-url">{payload.url}</div>
        {payload.error && (
          <div className="network-error">
            {payload.error.name}: {payload.error.message}
          </div>
        )}
      </div>
      <div className="detail-tabs">
        {TABS.map((item) => (
          <button className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </div>
      <div className="network-tab-content">
        {tab === 'headers' && (
          <>
            <h3>Request headers</h3>
            <DataBlock value={payload.requestHeaders} empty="No request headers captured." />
            <h3>Response headers</h3>
            <DataBlock value={payload.responseHeaders} empty="No response headers captured." />
            <h3>Query parameters</h3>
            <DataBlock value={payload.query} empty="No query parameters." />
          </>
        )}
        {tab === 'request' && (
          <>
            {payload.requestBody?.truncated && (
              <div className="truncated-note">Request body truncated at the configured limit.</div>
            )}
            <DataBlock value={payload.requestBody?.value} empty="No request body captured." />
          </>
        )}
        {tab === 'response' && (
          <>
            {payload.responseBody?.truncated && (
              <div className="truncated-note">Response body truncated at the configured limit.</div>
            )}
            <DataBlock value={payload.responseBody?.value} empty="No response body captured." />
          </>
        )}
        {tab === 'timing' && (
          <div className="timing-grid">
            <span>Started</span>
            <strong>{new Date(payload.startedAt).toISOString()}</strong>
            <span>Ended</span>
            <strong>{new Date(payload.endedAt).toISOString()}</strong>
            <span>Duration</span>
            <strong>{payload.duration.toFixed(2)} ms</strong>
            <span>Transport</span>
            <strong>{payload.transport}</strong>
          </div>
        )}
      </div>
    </>
  );
}
