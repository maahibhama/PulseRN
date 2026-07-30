import { describe, expect, it, vi } from 'vitest';
import { createDevToolMiddleware, diffStates } from '../src/index.js';

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
});

describe('diffStates', () => {
  it('reports additions and removals', () => {
    expect(diffStates({ old: true }, { next: true })).toEqual([
      { path: '$.old', kind: 'removed', before: true },
      { path: '$.next', kind: 'added', after: true },
    ]);
  });
});
