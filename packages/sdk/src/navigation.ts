import type {
  JsonValue,
  NavigationEventPayload,
  NavigationRoute,
  ReduxStateDiff,
} from './protocol-types.js';
import { redact } from '@pulse-rn/shared';

export interface NavigationTrackTarget {
  track(event: {
    category: 'navigation';
    type: string;
    payload: NavigationEventPayload;
    correlationId?: string;
    parentId?: string;
  }): void;
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
  integrationMetadata?: JsonValue;
  getCorrelationContext?: () =>
    | {
        correlationId?: string;
        parentId?: string;
        requestId?: string;
        reduxEventId?: string;
        performanceEventId?: string;
        consoleEventId?: string;
        errorId?: string;
      }
    | undefined;
}

export interface ManualNavigationInput {
  lifecycle?: 'ready' | 'state' | 'focus' | 'blur';
  action?: NavigationAction;
  route?: NavigationRouteLike;
  previousRoute?: NavigationRouteLike;
  rootState?: NavigationStateLike;
  integrationMetadata?: JsonValue;
}

const activeNavigatorIds = new Map<string, number>();

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

export function getActiveRoutePath(state?: NavigationStateLike): NavigationRouteLike[] {
  const path: NavigationRouteLike[] = [];
  let current = state;
  while (current?.routes?.length) {
    const index = Math.min(
      Math.max(current.index ?? current.routes.length - 1, 0),
      current.routes.length - 1,
    );
    const route = current.routes[index];
    if (!route) break;
    path.push(route);
    current = route.state;
  }
  return path;
}

function diffParams(
  previous: JsonValue | undefined,
  next: JsonValue | undefined,
  path = '$',
  output: ReduxStateDiff[] = [],
): ReduxStateDiff[] {
  if (JSON.stringify(previous) === JSON.stringify(next) || output.length >= 1_000) return output;
  const beforeObject =
    previous !== null && typeof previous === 'object' && !Array.isArray(previous);
  const afterObject = next !== null && typeof next === 'object' && !Array.isArray(next);
  if (beforeObject && afterObject) {
    const before = previous as Record<string, JsonValue>;
    const after = next as Record<string, JsonValue>;
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!(key in before))
        output.push({ path: `${path}.${key}`, kind: 'added', after: after[key]! });
      else if (!(key in after))
        output.push({ path: `${path}.${key}`, kind: 'removed', before: before[key]! });
      else diffParams(before[key], after[key], `${path}.${key}`, output);
    }
    return output;
  }
  output.push({ path, kind: 'changed', before: previous, after: next });
  return output;
}

function actionGroup(action: NavigationAction): NavigationEventPayload['actionGroup'] {
  if (action === 'navigate' || action === 'push' || action === 'replace') return 'forward';
  if (action === 'pop' || action === 'back') return 'backward';
  if (action === 'reset') return 'reset';
  return 'unknown';
}

export function createNavigationTracker(options: NavigationTrackerOptions) {
  const navigatorId = options.navigatorId ?? 'root';
  const source = options.source ?? 'react-navigation';
  const maxDepth = options.maxParamDepth ?? 10;
  let currentRoute: NavigationRoute | undefined;
  let routeStartedAt: number | undefined;
  let removeListeners: (() => void)[] = [];
  let lastTree: NavigationEventPayload['routeTree'];
  const existingCount = activeNavigatorIds.get(navigatorId) ?? 0;
  activeNavigatorIds.set(navigatorId, existingCount + 1);

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

  const buildTree = (state?: NavigationStateLike): NavigationEventPayload['routeTree'] => {
    if (!state?.routes?.length) return undefined;
    const tree: NonNullable<NavigationEventPayload['routeTree']> = [];
    const visit = (
      current: NavigationStateLike,
      ownerId: string,
      parentNavigatorId: string | undefined,
      depth: number,
    ) => {
      const routes = current.routes ?? [];
      const activeIndex = Math.min(
        Math.max(current.index ?? routes.length - 1, 0),
        Math.max(routes.length - 1, 0),
      );
      routes.forEach((route, index) => {
        const childNavigatorId = `${ownerId}/${route.key ?? route.name}`;
        const sanitized = sanitizeRoute(route);
        if (!sanitized) return;
        tree.push({
          navigatorId: ownerId,
          ...(parentNavigatorId ? { parentNavigatorId } : {}),
          route: sanitized,
          active: index === activeIndex,
          depth,
        });
        if (route.state) visit(route.state, childNavigatorId, ownerId, depth + 1);
      });
    };
    visit(state, navigatorId, undefined, 0);
    return tree;
  };

  const emit = (
    lifecycle: NavigationEventPayload['lifecycle'],
    nextRoute?: NavigationRouteLike,
    action: NavigationAction = 'unknown',
    explicitPrevious?: NavigationRouteLike,
    state?: NavigationStateLike,
    inputMetadata?: JsonValue,
  ) => {
    const now = Date.now();
    const next = sanitizeRoute(nextRoute);
    const previous = explicitPrevious ? sanitizeRoute(explicitPrevious) : currentRoute;
    const routeTree = buildTree(state) ?? lastTree;
    const routePath = state
      ? getActiveRoutePath(state).map((route) => route.name)
      : next
        ? [next.name]
        : undefined;
    const parameterDiff = diffParams(previous?.params, next?.params);
    const warnings: NonNullable<NavigationEventPayload['warnings']> = [];
    if (existingCount > 0) warnings.push('duplicate_navigator_id');
    if (!next || !next.key) warnings.push('incomplete_tracking');
    if (
      routeTree?.some(
        (node) =>
          node.parentNavigatorId &&
          !routeTree.some((candidate) => candidate.navigatorId === node.parentNavigatorId),
      )
    )
      warnings.push('inconsistent_ancestry');
    const correlation = options.getCorrelationContext?.();
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
      ...(routePath?.length ? { routePath } : {}),
      ...(routeTree?.length ? { routeTree } : {}),
      ...(parameterDiff.length ? { parameterDiff } : {}),
      actionGroup:
        lifecycle === 'focus' || lifecycle === 'blur' ? 'lifecycle' : actionGroup(action),
      ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}),
      ...((inputMetadata ?? options.integrationMetadata)
        ? { integrationMetadata: inputMetadata ?? options.integrationMetadata }
        : {}),
      ...(correlation
        ? {
            correlations: {
              ...(correlation.requestId ? { requestId: correlation.requestId } : {}),
              ...(correlation.reduxEventId ? { reduxEventId: correlation.reduxEventId } : {}),
              ...(correlation.performanceEventId
                ? { performanceEventId: correlation.performanceEventId }
                : {}),
              ...(correlation.consoleEventId ? { consoleEventId: correlation.consoleEventId } : {}),
              ...(correlation.errorId ? { errorId: correlation.errorId } : {}),
            },
          }
        : {}),
    };
    options.client.track({
      category: 'navigation',
      type: `navigation.${lifecycle}`,
      payload,
      ...(correlation?.correlationId ? { correlationId: correlation.correlationId } : {}),
      ...(correlation?.parentId ? { parentId: correlation.parentId } : {}),
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
      lastTree = routeTree;
    }
  };

  const routeFrom = (state?: NavigationStateLike, ref?: NavigationRefLike) =>
    ref?.getCurrentRoute?.() ?? getActiveRoute(state ?? ref?.getRootState?.());

  return {
    onReady(ref: NavigationRefLike): void {
      const state = ref.getRootState?.();
      emit('ready', routeFrom(state, ref), 'unknown', undefined, state);
    },
    onStateChange(state?: NavigationStateLike, ref?: NavigationRefLike): void {
      const rootState = state ?? ref?.getRootState?.();
      emit('state', routeFrom(rootState, ref), 'unknown', undefined, rootState);
    },
    track(input: ManualNavigationInput): void {
      emit(
        input.lifecycle ?? 'state',
        input.route ?? getActiveRoute(input.rootState),
        input.action,
        input.previousRoute,
        input.rootState,
        input.integrationMetadata,
      );
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
      const count = activeNavigatorIds.get(navigatorId) ?? 1;
      if (count <= 1) activeNavigatorIds.delete(navigatorId);
      else activeNavigatorIds.set(navigatorId, count - 1);
    },
  };
}
