import type { DevToolEventCategory, DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 250;

export function useInspectorEvents(
  categories: DevToolEventCategory[] | undefined,
  liveEventId?: string,
) {
  const [events, setEvents] = useState<DevToolEventEnvelope[]>([]);
  const [cursor, setCursor] =
    useState<Awaited<ReturnType<typeof window.pulseRN.queryEvents>>['nextCursor']>();
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const categoryKey = categories?.join(',') ?? '';

  const refresh = useCallback(async () => {
    if (!categories?.length) {
      setEvents([]);
      setCursor(undefined);
      setHasMore(false);
      setTotal(0);
      return;
    }
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const page = await window.pulseRN.queryEvents({
        categories,
        limit: PAGE_SIZE,
        order: 'newest',
      });
      if (request !== generation.current) return;
      setEvents(page.events);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setTotal(page.total);
    } catch (cause) {
      if (request === generation.current) {
        setError(cause instanceof Error ? cause.message : 'Unable to load inspector events.');
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [categoryKey]);

  const loadMore = useCallback(async () => {
    if (!categories?.length || loading || !hasMore || !cursor) return;
    setLoading(true);
    setError('');
    try {
      const page = await window.pulseRN.queryEvents({
        categories,
        cursor,
        limit: PAGE_SIZE,
        order: 'newest',
      });
      setEvents((current) => {
        const ids = new Set(current.map((event) => event.id));
        return [...current, ...page.events.filter((event) => !ids.has(event.id))];
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setTotal(page.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load more inspector events.');
    } finally {
      setLoading(false);
    }
  }, [categoryKey, cursor, hasMore, loading]);

  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (liveEventId && categories?.length) void refresh();
  }, [liveEventId, refresh]);

  return { error, events, hasMore, loadMore, loading, refresh, total };
}
