import { reduxEventPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useMemo, useState } from 'react';

type ReduxTab = 'action' | 'previous' | 'next' | 'diff';

function ReduxValue({ name, value, depth = 0 }: { name?: string; value: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth === 0);
  const structured = value !== null && typeof value === 'object';
  if (!structured) {
    return (
      <div className="redux-tree-row" style={{ paddingLeft: `${depth * 14}px` }}>
        {name && <strong>{name}: </strong>}
        <span>{typeof value === 'string' ? value : JSON.stringify(value)}</span>
      </div>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <div className="redux-tree-node">
      <button
        className="redux-tree-row"
        onClick={() => setOpen((current) => !current)}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        <span>{open ? '▾' : '▸'}</span>
        {name && <strong>{name}</strong>}
        <small>
          {Array.isArray(value) ? `Array(${entries.length})` : `{${entries.length} properties}`}
        </small>
      </button>
      {open &&
        entries.map(([key, item]) => (
          <ReduxValue depth={depth + 1} key={key} name={key} value={item} />
        ))}
    </div>
  );
}

export function ReduxEventDetails({ event }: { event: DevToolEventEnvelope }) {
  const parsed = reduxEventPayloadSchema.safeParse(event.payload);
  const [tab, setTab] = useState<ReduxTab>('action');
  const [diffSearch, setDiffSearch] = useState('');
  const payload = parsed.success ? parsed.data : undefined;
  const visibleDiff = useMemo(() => {
    const query = diffSearch.trim().toLowerCase();
    return (payload?.stateDiff ?? []).filter((item) =>
      `${item.path} ${item.kind}`.toLowerCase().includes(query),
    );
  }, [diffSearch, payload?.stateDiff]);
  if (!parsed.success) return <p className="network-error">Invalid Redux event payload.</p>;
  if (!payload) return <p className="network-error">Invalid Redux event payload.</p>;
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
          {payload.actionCategory && (
            <span className="redux-category">{payload.actionCategory}</span>
          )}
        </div>
        <div className="timing-grid">
          <span>Reducer</span>
          <strong>{payload.reducerDuration.toFixed(3)} ms</strong>
          <span>Changes</span>
          <strong>{payload.stateDiff?.length ?? 'Not captured'}</strong>
          <span>State size</span>
          <strong>
            {payload.stateSize
              ? `${payload.stateSize.previousBytes.toLocaleString()} → ${payload.stateSize.nextBytes.toLocaleString()} bytes`
              : 'Unavailable'}
          </strong>
        </div>
        {payload.stateSize &&
          (payload.stateSize.truncated ||
            payload.stateSize.previousBytes >= payload.stateSize.warningThresholdBytes ||
            payload.stateSize.nextBytes >= payload.stateSize.warningThresholdBytes) && (
            <div className="redux-state-warning">
              {payload.stateSize.truncated
                ? 'State capture was bounded; inspect changed paths before increasing limits.'
                : 'Large Redux state may increase capture and rendering cost.'}
            </div>
          )}
        {payload.correlations && (
          <div className="redux-correlations">
            {Object.entries(payload.correlations).map(([name, value]) => (
              <span key={name}>
                {name}: <strong>{value}</strong>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="detail-tabs">
        {(['action', 'previous', 'next', 'diff'] as const).map((name) => (
          <button className={tab === name ? 'active' : ''} key={name} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </div>
      <div className="network-tab-content">
        {tab === 'diff' ? (
          <>
            <input
              aria-label="Search Redux changed paths"
              onChange={(event) => setDiffSearch(event.target.value)}
              placeholder="Search changed paths…"
              type="search"
              value={diffSearch}
            />
            <div className="redux-changed-paths">
              {visibleDiff.map((item) => (
                <details key={`${item.path}:${item.kind}`}>
                  <summary>
                    <span>{item.kind}</span> {item.path}
                  </summary>
                  <ReduxValue name="before" value={item.before} />
                  <ReduxValue name="after" value={item.after} />
                </details>
              ))}
              {!visibleDiff.length && <p className="tab-empty">No matching changed paths.</p>}
            </div>
          </>
        ) : values[tab] === undefined ? (
          <p className="tab-empty">This value was not captured by the middleware configuration.</p>
        ) : (
          <div className="redux-tree">
            <ReduxValue value={values[tab]} />
          </div>
        )}
      </div>
    </>
  );
}
