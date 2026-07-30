import { reduxEventPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useState } from 'react';

type ReduxTab = 'action' | 'previous' | 'next' | 'diff';

export function ReduxEventDetails({ event }: { event: DevToolEventEnvelope }) {
  const parsed = reduxEventPayloadSchema.safeParse(event.payload);
  const [tab, setTab] = useState<ReduxTab>('action');
  if (!parsed.success) return <p className="network-error">Invalid Redux event payload.</p>;
  const payload = parsed.data;
  const values: Record<ReduxTab, unknown> = {
    action: payload.action,
    previous: payload.previousState,
    next: payload.nextState,
    diff: payload.stateDiff,
  };

  return (
    <>
      <div className="network-summary">
        <div className="request-line">
          <span className="store-badge">{payload.storeId}</span>
          <strong>{payload.actionType}</strong>
        </div>
        <div className="timing-grid">
          <span>Reducer</span>
          <strong>{payload.reducerDuration.toFixed(3)} ms</strong>
          <span>Changes</span>
          <strong>{payload.stateDiff?.length ?? 'Not captured'}</strong>
        </div>
      </div>
      <div className="detail-tabs">
        {(['action', 'previous', 'next', 'diff'] as const).map((name) => (
          <button className={tab === name ? 'active' : ''} key={name} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </div>
      <div className="network-tab-content">
        {values[tab] === undefined ? (
          <p className="tab-empty">This value was not captured by the middleware configuration.</p>
        ) : (
          <pre>{JSON.stringify(values[tab], null, 2)}</pre>
        )}
      </div>
    </>
  );
}
