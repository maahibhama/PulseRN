import { describe, expect, it, vi } from 'vitest';
import { createNavigationTracker, getActiveRoute, getActiveRoutePath } from '../src/navigation.js';

describe('navigation tracker', () => {
  it('finds the deepest active route', () => {
    expect(
      getActiveRoute({
        index: 1,
        routes: [
          { name: 'Home' },
          { name: 'Tabs', state: { index: 0, routes: [{ name: 'Profile' }] } },
        ],
      })?.name,
    ).toBe('Profile');
    expect(
      getActiveRoutePath({
        index: 1,
        routes: [
          { name: 'Home' },
          { name: 'Tabs', state: { index: 0, routes: [{ name: 'Profile' }] } },
        ],
      }).map(({ name }) => name),
    ).toEqual(['Tabs', 'Profile']);
  });

  it('emits redacted route transitions', () => {
    const track = vi.fn();
    const tracker = createNavigationTracker({
      client: { track },
      navigatorId: 'app',
      redactedFields: ['token'],
    });
    tracker.track({ lifecycle: 'ready', route: { key: 'home-1', name: 'Home' } });
    tracker.track({
      action: 'push',
      route: { key: 'details-1', name: 'Details', params: { id: 7, token: 'secret' } },
    });
    expect(track).toHaveBeenCalledTimes(2);
    expect(track.mock.calls[1]![0].payload).toMatchObject({
      navigatorId: 'app',
      action: 'push',
      previousRoute: { name: 'Home' },
      currentRoute: { name: 'Details', params: { id: 7, token: '[REDACTED]' } },
    });
  });

  it('restores listeners on dispose', () => {
    const remove = vi.fn();
    const tracker = createNavigationTracker({ client: { track: vi.fn() } });
    tracker.attach({
      getCurrentRoute: () => ({ name: 'Home' }),
      addListener: () => remove,
    });
    tracker.dispose();
    expect(remove).toHaveBeenCalledTimes(3);
  });

  it('normalizes nested route ownership, parameter diffs, metadata, and correlations', () => {
    const track = vi.fn();
    const tracker = createNavigationTracker({
      client: { track },
      navigatorId: 'expo-root',
      source: 'expo-router',
      integrationMetadata: { pathname: '/users/[id]' },
      getCorrelationContext: () => ({
        correlationId: 'flow-1',
        requestId: 'request-1',
        reduxEventId: 'redux-1',
      }),
    });
    tracker.track({
      lifecycle: 'ready',
      route: { key: 'user-1', name: 'User', params: { id: 1 } },
      rootState: {
        index: 0,
        routes: [
          {
            key: 'tabs-1',
            name: 'Tabs',
            state: {
              index: 0,
              routes: [{ key: 'user-1', name: 'User', params: { id: 1 } }],
            },
          },
        ],
      },
    });
    tracker.track({
      action: 'replace',
      previousRoute: { key: 'user-1', name: 'User', params: { id: 1 } },
      route: { key: 'user-2', name: 'User', params: { id: 2, tab: 'activity' } },
      rootState: {
        index: 0,
        routes: [
          {
            key: 'tabs-1',
            name: 'Tabs',
            state: {
              index: 0,
              routes: [{ key: 'user-2', name: 'User', params: { id: 2, tab: 'activity' } }],
            },
          },
        ],
      },
    });

    const event = track.mock.calls[1]![0];
    expect(event).toMatchObject({ correlationId: 'flow-1' });
    expect(event.payload).toMatchObject({
      source: 'expo-router',
      routePath: ['Tabs', 'User'],
      actionGroup: 'forward',
      parameterDiff: [
        { path: '$.id', kind: 'changed', before: 1, after: 2 },
        { path: '$.tab', kind: 'added', after: 'activity' },
      ],
      correlations: { requestId: 'request-1', reduxEventId: 'redux-1' },
      integrationMetadata: { pathname: '/users/[id]' },
    });
    expect(event.payload.routeTree).toHaveLength(2);
    expect(event.payload.routeTree?.[1]).toMatchObject({
      navigatorId: 'expo-root/tabs-1',
      parentNavigatorId: 'expo-root',
      route: { name: 'User' },
      active: true,
      depth: 1,
    });
    tracker.dispose();
  });

  it('warns about duplicate identifiers and incomplete manual tracking', () => {
    const first = createNavigationTracker({
      client: { track: vi.fn() },
      navigatorId: 'duplicate',
    });
    const track = vi.fn();
    const second = createNavigationTracker({
      client: { track },
      navigatorId: 'duplicate',
      source: 'manual',
    });
    second.track({ route: { name: 'Unkeyed' } });
    expect(track.mock.calls[0]![0].payload.warnings).toEqual([
      'duplicate_navigator_id',
      'incomplete_tracking',
    ]);
    first.dispose();
    second.dispose();
  });
});
