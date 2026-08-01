import {
  networkEventPayloadSchema,
  networkLifecycleEventPayloadSchema,
  type DevToolEventEnvelope,
} from '@pulse-rn/protocol';
import { useMemo, useState } from 'react';

interface NetworkEventDetailsProps {
  event: DevToolEventEnvelope;
}

type DetailTab = 'headers' | 'request' | 'response' | 'timing';
const TABS: readonly DetailTab[] = ['headers', 'request', 'response', 'timing'];

function DataBlock({ value, empty }: { value: unknown; empty: string }) {
  const [open, setOpen] = useState(false);
  if (value === undefined || value === null) return <div className="tab-empty">{empty}</div>;
  return (
    <div className="lazy-network-data">
      <button onClick={() => setOpen((current) => !current)}>
        {open ? 'Hide captured value' : 'Load captured value'}
      </button>
      {open && <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>}
    </div>
  );
}

export function NetworkEventDetails({ event }: NetworkEventDetailsProps) {
  const [tab, setTab] = useState<DetailTab>('headers');
  const [headerSearch, setHeaderSearch] = useState('');
  const [message, setMessage] = useState('');
  const parsed = networkEventPayloadSchema.safeParse(event.payload);
  const lifecycle = networkLifecycleEventPayloadSchema.safeParse(event.payload);
  const payload = parsed.success ? parsed.data : undefined;
  const matchingHeaders = useMemo(() => {
    const query = headerSearch.trim().toLowerCase();
    const filter = (headers: Record<string, string> | undefined) =>
      Object.fromEntries(
        Object.entries(headers ?? {}).filter(([name, value]) =>
          `${name}: ${value}`.toLowerCase().includes(query),
        ),
      );
    return {
      request: filter(payload?.requestHeaders),
      response: filter(payload?.responseHeaders),
      query: Object.fromEntries(
        Object.entries(payload?.query ?? {}).filter(([name, value]) =>
          `${name}: ${JSON.stringify(value)}`.toLowerCase().includes(query),
        ),
      ),
    };
  }, [headerSearch, payload?.query, payload?.requestHeaders, payload?.responseHeaders]);

  if (!parsed.success) {
    if (!lifecycle.success) return <div className="details-empty">Invalid network payload.</div>;
    const payload = lifecycle.data;
    return (
      <div className="network-lifecycle-detail">
        <strong>{payload.phase.replace('-', ' ')}</strong>
        <span>{payload.method}</span>
        <code>{payload.url}</code>
        <span>
          {payload.timingAccuracy === 'approximate' ? 'Approximate' : 'Measured'} React Native
          timing
        </span>
        {payload.loadedBytes !== undefined && (
          <span>
            {payload.loadedBytes.toLocaleString()} bytes
            {payload.totalBytes ? ` / ${payload.totalBytes.toLocaleString()}` : ''}
          </span>
        )}
        {payload.error && <span className="network-error">{payload.error.message}</span>}
        {payload.initiator && <pre>{payload.initiator}</pre>}
      </div>
    );
  }
  if (!payload) return <div className="details-empty">Invalid network payload.</div>;

  return (
    <>
      <div className="network-summary">
        <div className="request-line">
          <span className="method-badge">{payload.method}</span>
          <strong>{payload.status ?? 'ERR'}</strong>
          <span>
            {payload.timingAccuracy === 'approximate' ? '~' : ''}
            {payload.duration.toFixed(0)} ms
          </span>
          <button
            onClick={() => {
              void window.pulseRN
                .getNetworkCurl(event.id)
                .then(async (command) => {
                  await navigator.clipboard.writeText(command);
                  setMessage('Sanitized cURL copied.');
                })
                .catch((cause: unknown) =>
                  setMessage(cause instanceof Error ? cause.message : 'Unable to copy cURL.'),
                );
            }}
          >
            Copy as cURL
          </button>
        </div>
        <div className="detail-url">{payload.url}</div>
        {message && <small>{message}</small>}
        {payload.error && (
          <div className="network-error">
            {payload.error.name}: {payload.error.message}
          </div>
        )}
        {payload.capture?.omittedBodies.length ? (
          <div className="truncated-note">
            Capture budget omitted: {payload.capture.omittedBodies.join(', ')} body.
          </div>
        ) : null}
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
            <input
              aria-label="Search network headers and query"
              onChange={(input) => setHeaderSearch(input.target.value)}
              placeholder="Search headers and query"
              value={headerSearch}
            />
            <h3>Request headers</h3>
            <DataBlock value={matchingHeaders.request} empty="No request headers captured." />
            <h3>Response headers</h3>
            <DataBlock value={matchingHeaders.response} empty="No response headers captured." />
            <h3>Query parameters</h3>
            <DataBlock value={matchingHeaders.query} empty="No query parameters." />
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
            <span>Accuracy</span>
            <strong>{payload.timingAccuracy ?? 'approximate'}</strong>
            <span>Transport</span>
            <strong>{payload.transport}</strong>
            <span>Correlation</span>
            <strong>{event.correlationId ?? payload.requestId}</strong>
            <span>Initiator</span>
            <strong>{payload.initiator ? 'Captured below' : 'Unavailable'}</strong>
            {payload.initiator && <pre>{payload.initiator}</pre>}
            {payload.redirectChain?.map((redirect, index) => (
              <div className="network-redirect" key={`${redirect.from}:${index}`}>
                {redirect.status ?? 'Redirect'} · {redirect.from} → {redirect.to}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
