import type { JsonValue, NavigationEventPayload, NavigationRoute } from './protocol-types.js';
import { redact } from '@pulse-rn/shared';

export interface NavigationTrackTarget {
  track(event: { category: 'navigation'; type: string; payload: NavigationEventPayload }): void;
}

export interface NavigationStateLike {
  index?: number;
  routes?: readonly NavigationRouteLike[];
}

export interface NavigationRouteLike {
  key?: string;
  name: string;
  path?: string;
  params?: unknown;
  state?: NavigationStateLike;
}

export interface NavigationRefLike {
  getCurrentRoute?(): NavigationRouteLike | undefined;
  getRootState?(): NavigationStateLike;
  addListener?(event: 'state' | 'focus' | 'blur', listener: () => void): () => void;
}

export type NavigationAction =
  'navigate' | 'push' | 'pop' | 'replace' | 'reset' | 'back' | 'unknown';

export interface NavigationTrackerOptions {
  client: NavigationTrackTarget;
  navigatorId?: string;
  source?: 'react-navigation' | 'expo-router' | 'manual';
  redactedFields?: readonly string[];
  maxParamDepth?: number;
}

export interface ManualNavigationInput {
  lifecycle?: 'ready' | 'state' | 'focus' | 'blur';
  action?: NavigationAction;
  route?: NavigationRouteLike;
  previousRoute?: NavigationRouteLike;
}

function toJson(
  value: unknown,
  maxDepth: number,
  depth = 0,
  seen = new WeakSet<object>(),
): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'undefined') return '[Undefined]';
  if (typeof value !== 'object') return String(value);
  if (depth >= maxDepth) return '[Max depth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => toJson(item, maxDepth, depth + 1, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, toJson(item, maxDepth, depth + 1, seen)]),
  );
}

export function getActiveRoute(state?: NavigationStateLike): NavigationRouteLike | undefined {
  if (!state?.routes?.length) return undefined;
  const index = Math.min(
    Math.max(state.index ?? state.routes.length - 1, 0),
    state.routes.length - 1,
  );
  const route = state.routes[index];
  return route?.state ? (getActiveRoute(route.state) ?? route) : route;
}

export function createNavigationTracker(options: NavigationTrackerOptions) {
  const navigatorId = options.navigatorId ?? 'root';
  const source = options.source ?? 'react-navigation';
  const maxDepth = options.maxParamDepth ?? 10;
  let currentRoute: NavigationRoute | undefined;
  let routeStartedAt: number | undefined;
  let removeListeners: (() => void)[] = [];

  const sanitizeRoute = (route?: NavigationRouteLike): NavigationRoute | undefined => {
    if (!route) return undefined;
    const params =
      route.params === undefined
        ? undefined
        : (redact(toJson(route.params, maxDepth), {
            fields: options.redactedFields,
          }) as JsonValue);
    return {
      name: route.name,
      ...(route.key ? { key: route.key } : {}),
      ...(route.path ? { path: route.path } : {}),
      ...(params !== undefined ? { params } : {}),
    };
  };

  const emit = (
    lifecycle: NavigationEventPayload['lifecycle'],
    nextRoute?: NavigationRouteLike,
    action: NavigationAction = 'unknown',
    explicitPrevious?: NavigationRouteLike,
  ) => {
    const now = Date.now();
    const next = sanitizeRoute(nextRoute);
    const previous = explicitPrevious ? sanitizeRoute(explicitPrevious) : currentRoute;
    const payload: NavigationEventPayload = {
      navigatorId,
      source,
      lifecycle,
      action,
      ...(previous ? { previousRoute: previous } : {}),
      ...(next ? { currentRoute: next } : {}),
      ...(previous && routeStartedAt !== undefined
        ? { previousRouteDuration: Math.max(0, now - routeStartedAt) }
        : {}),
    };
    options.client.track({
      category: 'navigation',
      type: `navigation.${lifecycle}`,
      payload,
    });
    if (next && (lifecycle === 'ready' || lifecycle === 'state' || lifecycle === 'focus')) {
      if (
        next.key !== currentRoute?.key ||
        next.name !== currentRoute?.name ||
        next.path !== currentRoute?.path
      ) {
        routeStartedAt = now;
      }
      currentRoute = next;
    }
  };

  const routeFrom = (state?: NavigationStateLike, ref?: NavigationRefLike) =>
    ref?.getCurrentRoute?.() ?? getActiveRoute(state ?? ref?.getRootState?.());

  return {
    onReady(ref: NavigationRefLike): void {
      emit('ready', routeFrom(undefined, ref));
    },
    onStateChange(state?: NavigationStateLike, ref?: NavigationRefLike): void {
      emit('state', routeFrom(state, ref));
    },
    track(input: ManualNavigationInput): void {
      emit(input.lifecycle ?? 'state', input.route, input.action, input.previousRoute);
    },
    attach(ref: NavigationRefLike): () => void {
      removeListeners.forEach((remove) => remove());
      removeListeners = [];
      this.onReady(ref);
      if (ref.addListener) {
        removeListeners.push(
          ref.addListener('state', () => this.onStateChange(undefined, ref)),
          ref.addListener('focus', () => emit('focus', routeFrom(undefined, ref))),
          ref.addListener('blur', () => emit('blur', routeFrom(undefined, ref))),
        );
      }
      return this.dispose;
    },
    dispose(): void {
      removeListeners.forEach((remove) => remove());
      removeListeners = [];
    },
  };
}
