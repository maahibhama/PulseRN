import { navigationEventPayloadSchema, type DevToolEventEnvelope } from '@pulse-rn/protocol';

export function NavigationEventDetails({
  event,
  onSelect,
}: {
  event: DevToolEventEnvelope;
  onSelect?(id: string): void;
}) {
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
      {payload.routePath?.length && (
        <>
          <h3>Complete route path</h3>
          <div className="route-breadcrumb">
            {payload.routePath.map((route, index) => (
              <span key={`${route}:${index}`}>
                {index > 0 && <b>›</b>}
                {route}
              </span>
            ))}
          </div>
        </>
      )}
      {payload.warnings?.length && (
        <div className="navigation-warnings">
          {payload.warnings.map((warning) => (
            <span key={warning}>{warning.replaceAll('_', ' ')}</span>
          ))}
        </div>
      )}
      {payload.routeTree?.length && (
        <>
          <h3>Route tree</h3>
          <div className="route-tree">
            {payload.routeTree.map((node, index) => (
              <div
                className={node.active ? 'active' : ''}
                key={`${node.navigatorId}:${node.route.key ?? node.route.name}:${index}`}
                style={{ paddingLeft: `${node.depth * 14}px` }}
              >
                <small>{node.navigatorId}</small>
                <strong>{node.route.name}</strong>
              </div>
            ))}
          </div>
        </>
      )}
      {payload.parameterDiff?.length && (
        <>
          <h3>Parameter changes</h3>
          <div className="parameter-diff">
            {payload.parameterDiff.map((item) => (
              <div key={`${item.path}:${item.kind}`}>
                <span>{item.kind}</span>
                <code>{item.path}</code>
              </div>
            ))}
          </div>
        </>
      )}
      {payload.correlations && (
        <>
          <h3>Correlated context</h3>
          <div className="navigation-correlations">
            {Object.entries(payload.correlations).map(([name, id]) => (
              <button key={name} onClick={() => id && onSelect?.(id)}>
                {name}: {id}
              </button>
            ))}
          </div>
        </>
      )}
      {payload.currentRoute?.params !== undefined && (
        <>
          <h3>Current route parameters</h3>
          <pre>{JSON.stringify(payload.currentRoute.params, null, 2)}</pre>
        </>
      )}
      {payload.integrationMetadata !== undefined && (
        <>
          <h3>Integration metadata</h3>
          <pre>{JSON.stringify(payload.integrationMetadata, null, 2)}</pre>
        </>
      )}
    </>
  );
}
