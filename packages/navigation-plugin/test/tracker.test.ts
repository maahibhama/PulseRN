import { describe, expect, it, vi } from 'vitest';
import { createNavigationTracker, getActiveRoute } from '../src/index.js';

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
});
