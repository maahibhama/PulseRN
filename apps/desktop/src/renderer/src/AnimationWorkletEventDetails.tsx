import {
  animationEventPayloadSchema,
  workletEventPayloadSchema,
  type DevToolEventEnvelope,
} from '@pulse-rn/protocol';

function Value({ value }: { value: unknown }) {
  return <code>{value === undefined ? '—' : String(value)}</code>;
}

export function AnimationWorkletEventDetails({ event }: { event: DevToolEventEnvelope }) {
  if (event.category === 'animation') {
    const parsed = animationEventPayloadSchema.safeParse(event.payload);
    if (!parsed.success) return null;
    const payload = parsed.data;
    return (
      <div className="animation-detail">
        <div className="animation-detail-hero">
          <span className={`animation-state ${payload.phase}`}>{payload.phase}</span>
          <div>
            <strong>{payload.animationType} animation</strong>
            <small>{payload.component ?? 'Unattributed component'}</small>
          </div>
        </div>
        <div className="animation-detail-grid">
          <span>Runtime</span>
          <Value value={payload.runtimeId ?? 'UI'} />
          <span>Duration</span>
          <Value
            value={
              payload.durationMs === undefined ? undefined : `${payload.durationMs.toFixed(2)} ms`
            }
          />
          <span>Initial</span>
          <Value value={payload.initialValue} />
          <span>Current</span>
          <Value value={payload.sampledValue} />
          <span>Target</span>
          <Value value={payload.targetValue} />
          <span>Progress</span>
          <Value
            value={
              payload.progress === undefined ? undefined : `${Math.round(payload.progress * 100)}%`
            }
          />
        </div>
        {payload.properties?.length ? (
          <section>
            <h3>Animated properties</h3>
            <div className="detail-chips">
              {payload.properties.map((property) => (
                <span key={property}>{property}</span>
              ))}
            </div>
          </section>
        ) : null}
        {payload.frame && (
          <section>
            <h3>Frame health</h3>
            <div className="frame-health-grid">
              <div>
                <strong>{payload.frame.effectiveFps.toFixed(1)}</strong>
                <span>Effective FPS</span>
              </div>
              <div className={payload.frame.lateFrames ? 'warning' : ''}>
                <strong>{payload.frame.lateFrames}</strong>
                <span>Late frames</span>
              </div>
              <div>
                <strong>{payload.frame.observedFrames}</strong>
                <span>Observed</span>
              </div>
              <div>
                <strong>{payload.frame.longestFrameMs.toFixed(1)} ms</strong>
                <span>Longest frame</span>
              </div>
            </div>
          </section>
        )}
        {payload.configuration && (
          <section>
            <h3>Configuration</h3>
            <pre>{JSON.stringify(payload.configuration, null, 2)}</pre>
          </section>
        )}
        {payload.source && (
          <section>
            <h3>Source</h3>
            <code className="detail-source">
              {payload.source.file}:{payload.source.line}:{payload.source.column ?? 0}
            </code>
          </section>
        )}
      </div>
    );
  }
  const parsed = workletEventPayloadSchema.safeParse(event.payload);
  if (!parsed.success) return null;
  const payload = parsed.data;
  return (
    <div className="animation-detail">
      <div className="animation-detail-hero">
        <span className={`animation-state ${payload.operation}`}>{payload.operation}</span>
        <div>
          <strong>{payload.workletName ?? payload.runtimeName ?? 'Worklet runtime'}</strong>
          <small>
            {payload.originRuntime ?? payload.runtimeKind} →{' '}
            {payload.destinationRuntime ?? payload.runtimeKind}
          </small>
        </div>
      </div>
      <div className="animation-detail-grid">
        <span>Runtime</span>
        <Value value={payload.runtimeName ?? payload.runtimeId} />
        <span>Queue wait</span>
        <Value
          value={
            payload.queueWaitMs === undefined ? undefined : `${payload.queueWaitMs.toFixed(2)} ms`
          }
        />
        <span>Execution</span>
        <Value
          value={
            payload.durationMs === undefined ? undefined : `${payload.durationMs.toFixed(2)} ms`
          }
        />
        <span>Payload</span>
        <Value
          value={
            payload.serializationBytes === undefined
              ? undefined
              : `${payload.serializationBytes} bytes`
          }
        />
      </div>
      {payload.error && (
        <section className="worklet-error">
          <h3>{payload.error.name}</h3>
          <p>{payload.error.message}</p>
          {payload.error.stack && <pre>{payload.error.stack}</pre>}
        </section>
      )}
      {payload.source && (
        <section>
          <h3>Scheduling source</h3>
          <code className="detail-source">
            {payload.source.file}:{payload.source.line}:{payload.source.column ?? 0}
          </code>
        </section>
      )}
    </div>
  );
}
