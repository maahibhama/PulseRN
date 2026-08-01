import type { DevToolEventCategory, DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 250;
export const MAX_RENDERER_EVENTS = 2_000;

function cursorOf(event: DevToolEventEnvelope | undefined) {
  return event ? { id: event.id, sequence: event.sequence, timestamp: event.timestamp } : undefined;
}

export function useInspectorEvents(
  categories: DevToolEventCategory[] | undefined,
  liveEventId?: string,
  sessionId?: string,
) {
  const [events, setEvents] = useState<DevToolEventEnvelope[]>([]);
  const [nextCursor, setNextCursor] =
    useState<Awaited<ReturnType<typeof window.pulseRN.queryEvents>>['nextCursor']>();
  const [previousCursor, setPreviousCursor] =
    useState<Awaited<ReturnType<typeof window.pulseRN.queryEvents>>['previousCursor']>();
  const [hasNext, setHasNext] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const categoryKey = categories?.join(',') ?? '';

  const refresh = useCallback(async () => {
    if (!categories?.length) {
      setEvents([]);
      setNextCursor(undefined);
      setPreviousCursor(undefined);
      setHasNext(false);
      setHasPrevious(false);
      setTotal(0);
      return;
    }
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const page = await window.pulseRN.queryEvents({
        categories,
        ...(sessionId ? { sessionId } : {}),
        limit: PAGE_SIZE,
        order: 'newest',
      });
      if (request !== generation.current) return;
      setEvents(page.events);
      setNextCursor(page.nextCursor);
      setPreviousCursor(page.previousCursor);
      setHasNext(page.hasNext);
      setHasPrevious(page.hasPrevious);
      setTotal(page.total);
    } catch (cause) {
      if (request === generation.current) {
        setError(cause instanceof Error ? cause.message : 'Unable to load inspector events.');
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [categoryKey, sessionId]);

  const loadMore = useCallback(async () => {
    if (!categories?.length || loading || !hasNext || !nextCursor) return;
    setLoading(true);
    setError('');
    try {
      const page = await window.pulseRN.queryEvents({
        categories,
        ...(sessionId ? { sessionId } : {}),
        cursor: nextCursor,
        direction: 'forward',
        limit: PAGE_SIZE,
        order: 'newest',
      });
      setEvents((current) => {
        const ids = new Set(current.map((event) => event.id));
        const combined = [...current, ...page.events.filter((event) => !ids.has(event.id))];
        const trimmed = combined.length > MAX_RENDERER_EVENTS;
        const bounded = trimmed ? combined.slice(-MAX_RENDERER_EVENTS) : combined;
        setPreviousCursor(trimmed || page.hasPrevious ? cursorOf(bounded[0]) : page.previousCursor);
        setHasPrevious(trimmed || page.hasPrevious);
        return bounded;
      });
      setNextCursor(page.nextCursor);
      setHasNext(page.hasNext);
      setTotal(page.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load more inspector events.');
    } finally {
      setLoading(false);
    }
  }, [categoryKey, hasNext, loading, nextCursor, sessionId]);

  const loadNewer = useCallback(async () => {
    if (!categories?.length || loading || !hasPrevious || !previousCursor) return;
    setLoading(true);
    setError('');
    try {
      const page = await window.pulseRN.queryEvents({
        categories,
        ...(sessionId ? { sessionId } : {}),
        cursor: previousCursor,
        direction: 'backward',
        limit: PAGE_SIZE,
        order: 'newest',
      });
      setEvents((current) => {
        const ids = new Set(page.events.map((event) => event.id));
        const combined = [...page.events, ...current.filter((event) => !ids.has(event.id))];
        const trimmed = combined.length > MAX_RENDERER_EVENTS;
        const bounded = trimmed ? combined.slice(0, MAX_RENDERER_EVENTS) : combined;
        setNextCursor(trimmed || page.hasNext ? cursorOf(bounded.at(-1)) : page.nextCursor);
        setHasNext(trimmed || page.hasNext);
        return bounded;
      });
      setPreviousCursor(page.previousCursor);
      setHasPrevious(page.hasPrevious);
      setTotal(page.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load newer inspector events.');
    } finally {
      setLoading(false);
    }
  }, [categoryKey, hasPrevious, loading, previousCursor, sessionId]);

  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (liveEventId && categories?.length) void refresh();
  }, [liveEventId, refresh]);

  return {
    error,
    events,
    hasMore: hasNext,
    hasNext,
    hasPrevious,
    loadMore,
    loadNewer,
    loading,
    refresh,
    total,
  };
}
