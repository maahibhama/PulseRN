import { describe, expect, it, vi } from 'vitest';
import { createDevToolMiddleware, diffStates } from '../src/redux.js';

describe('Redux middleware', () => {
  it('captures a redacted action, state transition, diff, and reducer duration', () => {
    let state = { count: 0, token: 'state-secret' };
    const track = vi.fn();
    const middleware = createDevToolMiddleware({
      client: { track },
      storeId: 'main',
      redactedFields: ['token'],
    })({ getState: () => state })((action) => {
      state = { ...state, count: state.count + 1 };
      return action;
    });
    const action = { type: 'counter/increment', token: 'action-secret' };
    expect(middleware(action)).toBe(action);
    expect(track).toHaveBeenCalledOnce();
    const payload = track.mock.calls[0]![0].payload;
    expect(payload.storeId).toBe('main');
    expect(payload.action).toEqual({ type: 'counter/increment', token: '[REDACTED]' });
    expect(payload.nextState).toEqual({ count: 1, token: '[REDACTED]' });
    expect(payload.stateDiff).toEqual([{ path: '$.count', kind: 'changed', before: 0, after: 1 }]);
  });

  it('supports filtering without preventing Redux dispatch', () => {
    const track = vi.fn();
    const next = vi.fn((action) => action);
    const middleware = createDevToolMiddleware({
      client: { track },
      actionFilter: (action) => (action as { type: string }).type !== 'ignored',
    })({ getState: () => ({}) })(next);
    middleware({ type: 'ignored' });
    expect(next).toHaveBeenCalledOnce();
    expect(track).not.toHaveBeenCalled();
  });

  it('applies allow, deny, and per-category policies independently per store', () => {
    const mainTrack = vi.fn();
    const analyticsTrack = vi.fn();
    const create = (storeId: string, track: typeof mainTrack, enabledCategories: string[]) =>
      createDevToolMiddleware({
        client: { track },
        storeId,
        actionAllowList: ['checkout/*', 'internal/blocked'],
        actionDenyList: ['internal/*'],
        actionCategories: {
          commerce: ['checkout/*'],
          internal: ['internal/*'],
        },
        enabledCategories,
      })({ getState: () => ({ ready: true }) })((action) => action);
    const main = create('main', mainTrack, ['commerce']);
    const analytics = create('analytics', analyticsTrack, ['internal']);

    main({ type: 'checkout/start' });
    main({ type: 'internal/blocked' });
    analytics({ type: 'checkout/start' });

    expect(mainTrack).toHaveBeenCalledOnce();
    expect(mainTrack.mock.calls[0]![0].payload).toMatchObject({
      storeId: 'main',
      actionCategory: 'commerce',
    });
    expect(analyticsTrack).not.toHaveBeenCalled();
  });

  it('bounds circular and oversized states and reports correlation context', () => {
    const circular: { items: string[]; self?: unknown } = {
      items: Array.from({ length: 100 }, (_, index) => `item-${index}`),
    };
    circular.self = circular;
    const track = vi.fn();
    const middleware = createDevToolMiddleware({
      client: { track },
      maxStateProperties: 8,
      maxStateBytes: 1_024,
      stateSizeWarningBytes: 1_024,
      getCorrelationContext: () => ({
        correlationId: 'flow-1',
        parentId: 'request-1',
        route: 'Checkout',
        requestId: 'request-1',
        errorId: 'error-1',
        performanceEventId: 'stall-1',
      }),
    })({ getState: () => circular })((action) => action);

    middleware({ type: 'checkout/large' });
    const tracked = track.mock.calls[0]![0];
    expect(tracked).toMatchObject({
      correlationId: 'flow-1',
      parentId: 'request-1',
      payload: {
        correlations: {
          route: 'Checkout',
          requestId: 'request-1',
          errorId: 'error-1',
          performanceEventId: 'stall-1',
        },
        stateSize: { truncated: true },
      },
    });
    expect(tracked.payload.changedPaths).toEqual([]);
    expect(JSON.stringify(tracked.payload)).toContain('[Property limit]');
  });
});

describe('diffStates', () => {
  it('reports additions and removals', () => {
    expect(diffStates({ old: true }, { next: true })).toEqual([
      { path: '$.old', kind: 'removed', before: true },
      { path: '$.next', kind: 'added', after: true },
    ]);
  });
});
