import { errorEventPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useState } from 'react';

const SENSITIVE_FIELD = /token|password|secret|authorization|cookie|api.?key/i;

function sanitizeReportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeReportValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        SENSITIVE_FIELD.test(key) ? '[REDACTED]' : sanitizeReportValue(nested),
      ]),
    );
  }
  return value;
}

function createIssueReport(
  event: DevToolEventEnvelope,
  payload: ReturnType<typeof errorEventPayloadSchema.parse>,
) {
  const sanitized = sanitizeReportValue({
    eventId: event.id,
    sessionId: event.sessionId,
    deviceId: event.deviceId,
    appId: event.appId,
    timestamp: event.timestamp,
    ...payload,
  });
  const applicationFrames = payload.frames?.filter((frame) => frame.application) ?? [];
  const markdown = [
    `## ${payload.name}`,
    '',
    payload.message,
    '',
    `- Fingerprint: \`${payload.fingerprint ?? 'unavailable'}\``,
    `- Classification: ${payload.classification ?? 'application'}`,
    `- App version: ${payload.appVersion ?? 'unknown'}`,
    `- Screen: ${payload.screen ?? 'unknown'}`,
    `- Fatal: ${payload.fatal ? 'yes' : 'no'}`,
    '',
    '### Application stack',
    '',
    '```text',
    ...applicationFrames.map(
      (frame) =>
        `${frame.functionName ?? '<anonymous>'} (${frame.file}${frame.line ? `:${frame.line}:${frame.column ?? 1}` : ''})`,
    ),
    '```',
  ].join('\n');
  return { markdown, json: JSON.stringify(sanitized, null, 2) };
}

export function ErrorEventDetails({ event }: { event: DevToolEventEnvelope }) {
  const [copied, setCopied] = useState<'markdown' | 'json'>();
  const parsed = errorEventPayloadSchema.safeParse(event.payload);
  if (!parsed.success) return <p className="invalid-payload">Invalid error payload.</p>;
  const payload = parsed.data;
  const report = createIssueReport(event, payload);
  const copyReport = async (format: 'markdown' | 'json') => {
    await navigator.clipboard.writeText(report[format]);
    setCopied(format);
  };

  return (
    <>
      <div className="error-report-actions">
        <button type="button" onClick={() => void copyReport('markdown')}>
          {copied === 'markdown' ? 'Copied Markdown' : 'Copy GitHub Markdown'}
        </button>
        <button type="button" onClick={() => void copyReport('json')}>
          {copied === 'json' ? 'Copied JSON' : 'Copy sanitized JSON'}
        </button>
      </div>
      <div className="detail-grid error-summary">
        <span>Classification</span>
        <strong>{(payload.classification ?? 'application').replaceAll('_', ' ')}</strong>
        <span>Fingerprint</span>
        <strong>{payload.fingerprint ?? 'Legacy event'}</strong>
        <span>Source</span>
        <strong>{payload.source.replaceAll('_', ' ')}</strong>
        <span>Fatal</span>
        <strong>{payload.fatal ? 'Yes' : 'No'}</strong>
        <span>Screen</span>
        <strong>{payload.screen ?? 'Unknown'}</strong>
        <span>App version</span>
        <strong>{payload.appVersion ?? 'Unknown'}</strong>
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
      {payload.frames && payload.frames.length > 0 && (
        <>
          <h3>Parsed and symbolicated frames</h3>
          <div className="error-frames">
            {payload.frames.map((frame, index) => (
              <div key={`${frame.file}:${frame.line ?? 0}:${index}`}>
                <span>{frame.application ? 'APP' : 'INTERNAL'}</span>
                <strong>{frame.functionName ?? '<anonymous>'}</strong>
                <code>
                  {frame.file}
                  {frame.line ? `:${frame.line}:${frame.column ?? 1}` : ''}
                </code>
                <small>{frame.symbolicated ? 'original source' : 'generated source'}</small>
              </div>
            ))}
          </div>
        </>
      )}
      {payload.correlations && (
        <>
          <h3>Correlated context</h3>
          <div className="detail-grid">
            {Object.entries(payload.correlations).map(([key, value]) => (
              <div key={key} className="error-correlation">
                <span>{key}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
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
