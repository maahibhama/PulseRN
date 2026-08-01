import type { DevToolEventCategory, DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConsolePanel } from './ConsolePanel.js';
import { ConnectionCenter } from './ConnectionCenter.js';
import { DebuggerPanel } from './DebuggerPanel.js';
import { EventDetails } from './EventDetails.js';
import { ErrorsPanel } from './ErrorsPanel.js';
import { NetworkPanel } from './NetworkPanel.js';
import { McpPanel } from './McpPanel.js';
import { NavigationPanel } from './NavigationPanel.js';
import { PerformancePanel } from './PerformancePanel.js';
import { ReduxPanel } from './ReduxPanel.js';
import { SettingsPanel } from './SettingsPanel.js';
import { SessionsPanel } from './SessionsPanel.js';
import { StoragePanel } from './StoragePanel.js';
import darkAppIcon from '../../../resources/pulse-rn-app-icon-dark.png';
import lightAppIcon from '../../../resources/pulse-rn-app-icon-light.png';
import { deviceLabel, findSelectedEvent, useDesktopStore } from './store.js';
import {
  latestMatchingEventId,
  MAX_RENDERER_EVENTS,
  useInspectorEvents,
} from './useInspectorEvents.js';
import type {
  EventAnnotation,
  EventBookmark,
  EventQuery,
  SavedEventFilter,
  StoredSession,
} from '../../preload/api.js';

type ViewName =
  | 'Timeline'
  | 'Connections'
  | 'Console'
  | 'Network'
  | 'Redux'
  | 'Navigation'
  | 'Performance'
  | 'Storage'
  | 'Errors'
  | 'Debugger'
  | 'Sessions'
  | 'MCP'
  | 'Settings';

const navItems: { name: ViewName; icon: string; available: boolean }[] = [
  { name: 'Timeline', icon: '⌁', available: true },
  { name: 'Connections', icon: '◉', available: true },
  { name: 'Console', icon: '>_', available: true },
  { name: 'Network', icon: '⇄', available: true },
  { name: 'Redux', icon: '◇', available: true },
  { name: 'Navigation', icon: '→', available: true },
  { name: 'Performance', icon: '⌁', available: true },
  { name: 'Storage', icon: '▤', available: true },
  { name: 'Errors', icon: '△', available: true },
  { name: 'Debugger', icon: '⏵', available: true },
  { name: 'Sessions', icon: '◫', available: true },
  { name: 'MCP', icon: 'M', available: true },
  { name: 'Settings', icon: '⚙', available: true },
];

const inspectorCategories: Partial<Record<ViewName, DevToolEventCategory[]>> = {
  Console: ['console'],
  Network: ['network'],
  Redux: ['redux'],
  Navigation: ['navigation'],
  Performance: ['performance', 'network', 'redux', 'navigation'],
  Errors: ['error'],
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

function TimelinePanel({
  density,
  liveEventId,
  selectedEventId,
  onSelect,
  order,
  onCloseSession,
  sessionId,
}: {
  density: 'comfortable' | 'compact';
  liveEventId?: string;
  selectedEventId?: string;
  onSelect(event: DevToolEventEnvelope): void;
  order: 'newest' | 'oldest';
  onCloseSession?(): void;
  sessionId?: string;
}) {
  const desktopApi = window.pulseRN;
  const [paused, setPaused] = useState(false);
  const [events, setEvents] = useState<DevToolEventEnvelope[]>([]);
  const [nextCursor, setNextCursor] =
    useState<Awaited<ReturnType<typeof desktopApi.queryEvents>>['nextCursor']>();
  const [previousCursor, setPreviousCursor] =
    useState<Awaited<ReturnType<typeof desktopApi.queryEvents>>['previousCursor']>();
  const [hasNext, setHasNext] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clearedAt, setClearedAt] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [filter, setFilter] = useState<Omit<EventQuery, 'cursor' | 'direction' | 'limit'>>({});
  const [savedFilters, setSavedFilters] = useState<SavedEventFilter[]>([]);
  const [selectedSavedFilter, setSelectedSavedFilter] = useState('');
  const [filterName, setFilterName] = useState('');
  const [bookmarks, setBookmarks] = useState<EventBookmark[]>([]);
  const [annotations, setAnnotations] = useState<EventAnnotation[]>([]);
  const [annotationBody, setAnnotationBody] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const rowHeight = density === 'compact' ? 36 : 42;
  const effectiveQuery = useMemo(
    () => ({
      ...filter,
      ...(sessionId ? { sessionId } : {}),
    }),
    [filter, sessionId],
  );

  const loadFirstPage = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError('');
    try {
      const page = await desktopApi.queryEvents({
        ...effectiveQuery,
        limit: 250,
        order,
      });
      if (generation !== requestGeneration.current) return;
      setEvents(page.events);
      setNextCursor(page.nextCursor);
      setPreviousCursor(page.previousCursor);
      setHasNext(page.hasNext);
      setHasPrevious(page.hasPrevious);
      setTotal(page.total);
      setScrollTop(0);
      if (listRef.current) listRef.current.scrollTop = 0;
    } catch (cause) {
      if (generation === requestGeneration.current) {
        setError(cause instanceof Error ? cause.message : 'Unable to load events.');
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [desktopApi, effectiveQuery, order]);

  const loadMore = useCallback(async () => {
    if (loading || !hasNext || !nextCursor) return;
    setLoading(true);
    setError('');
    try {
      const page = await desktopApi.queryEvents({
        ...effectiveQuery,
        cursor: nextCursor,
        direction: 'forward',
        limit: 250,
        order,
      });
      setEvents((current) => {
        const ids = new Set(current.map((event) => event.id));
        const combined = [...current, ...page.events.filter((event) => !ids.has(event.id))];
        const trimmed = combined.length > MAX_RENDERER_EVENTS;
        const bounded = trimmed ? combined.slice(-MAX_RENDERER_EVENTS) : combined;
        const first = bounded[0];
        setPreviousCursor(
          trimmed && first
            ? { id: first.id, sequence: first.sequence, timestamp: first.timestamp }
            : page.previousCursor,
        );
        setHasPrevious(trimmed || page.hasPrevious);
        return bounded;
      });
      setNextCursor(page.nextCursor);
      setHasNext(page.hasNext);
      setTotal(page.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load more events.');
    } finally {
      setLoading(false);
    }
  }, [desktopApi, effectiveQuery, hasNext, loading, nextCursor, order]);

  const loadNewer = useCallback(async () => {
    if (loading || !hasPrevious || !previousCursor) return;
    setLoading(true);
    setError('');
    try {
      const page = await desktopApi.queryEvents({
        ...effectiveQuery,
        cursor: previousCursor,
        direction: 'backward',
        limit: 250,
        order,
      });
      setEvents((current) => {
        const ids = new Set(page.events.map((event) => event.id));
        const combined = [...page.events, ...current.filter((event) => !ids.has(event.id))];
        const trimmed = combined.length > MAX_RENDERER_EVENTS;
        const bounded = trimmed ? combined.slice(0, MAX_RENDERER_EVENTS) : combined;
        const last = bounded.at(-1);
        setNextCursor(
          trimmed && last
            ? { id: last.id, sequence: last.sequence, timestamp: last.timestamp }
            : page.nextCursor,
        );
        setHasNext(trimmed || page.hasNext);
        return bounded;
      });
      setPreviousCursor(page.previousCursor);
      setHasPrevious(page.hasPrevious);
      setTotal(page.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load newer events.');
    } finally {
      setLoading(false);
    }
  }, [desktopApi, effectiveQuery, hasPrevious, loading, order, previousCursor]);

  useEffect(() => {
    void loadFirstPage();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadFirstPage]);

  useEffect(() => {
    if (!paused && liveEventId) void loadFirstPage();
  }, [liveEventId, loadFirstPage, paused]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const resize = () => setViewportHeight(list.clientHeight);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  const refreshMetadata = useCallback(async () => {
    const [nextFilters, nextBookmarks, nextAnnotations] = await Promise.all([
      desktopApi.listSavedFilters(),
      desktopApi.listBookmarks(sessionId),
      selectedEventId ? desktopApi.listAnnotations(selectedEventId) : Promise.resolve([]),
    ]);
    setSavedFilters(nextFilters);
    setBookmarks(nextBookmarks);
    setAnnotations(nextAnnotations);
  }, [desktopApi, selectedEventId, sessionId]);

  useEffect(() => {
    void refreshMetadata().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Unable to load timeline metadata.');
    });
  }, [refreshMetadata]);

  const displayed = useMemo(
    () => events.filter((event) => event.timestamp > clearedAt),
    [clearedAt, events],
  );
  const overscan = 8;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    displayed.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  );
  const visibleEvents = displayed.slice(startIndex, endIndex);
  const selectedIndex = displayed.findIndex((event) => event.id === selectedEventId);
  const selectedDisplayedEvent = selectedIndex >= 0 ? displayed[selectedIndex] : undefined;
  const selectedBookmark = bookmarks.find((bookmark) => bookmark.eventId === selectedEventId);

  const clearView = () => {
    setClearedAt(Date.now());
    setEvents([]);
    setNextCursor(undefined);
    setPreviousCursor(undefined);
    setHasNext(false);
    setHasPrevious(false);
    setTotal(0);
  };

  const saveCurrentFilter = async () => {
    if (!filterName.trim()) return;
    try {
      const saved = await desktopApi.saveEventFilter(filterName, filter);
      setSelectedSavedFilter(saved.id);
      setFilterName('');
      await refreshMetadata();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the filter.');
    }
  };

  const toggleBookmark = async () => {
    if (!selectedEventId) return;
    try {
      if (selectedBookmark) await desktopApi.deleteBookmark(selectedBookmark.id);
      else await desktopApi.addBookmark(selectedEventId);
      await refreshMetadata();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update the bookmark.');
    }
  };

  const addAnnotation = async () => {
    if (!selectedEventId || !annotationBody.trim()) return;
    try {
      await desktopApi.saveAnnotation(selectedEventId, annotationBody);
      setAnnotationBody('');
      await refreshMetadata();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the annotation.');
    }
  };

  return (
    <main className="timeline">
      <div className="panel-header">
        <div>
          <strong>Unified timeline</strong>
          <span>
            {displayed.length} loaded · {total} total{sessionId ? ' · reopened session' : ''}
          </span>
        </div>
        <div className="actions">
          {sessionId && <button onClick={onCloseSession}>All sessions</button>}
          <button className={paused ? 'control-active' : ''} onClick={() => setPaused(!paused)}>
            {paused ? 'Follow Latest' : 'Following Latest'}
          </button>
          <button disabled={!hasPrevious || loading} onClick={() => void loadNewer()}>
            Newer
          </button>
          <button onClick={clearView}>Clear</button>
        </div>
      </div>
      <div className="timeline-filters">
        <input
          aria-label="Search timeline text"
          onChange={(event) =>
            setFilter((current) => ({
              ...current,
              text: event.target.value || undefined,
            }))
          }
          placeholder="Search captured text"
          value={filter.text ?? ''}
        />
        <select
          aria-label="Filter event category"
          onChange={(event) =>
            setFilter((current) => ({
              ...current,
              category:
                event.target.value === ''
                  ? undefined
                  : (event.target.value as DevToolEventCategory),
            }))
          }
          value={filter.category ?? ''}
        >
          <option value="">All categories</option>
          {[
            'console',
            'network',
            'redux',
            'navigation',
            'performance',
            'storage',
            'error',
            'device',
            'interaction',
            'system',
          ].map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <input
          aria-label="Filter event type"
          onChange={(event) =>
            setFilter((current) => ({
              ...current,
              type: event.target.value || undefined,
            }))
          }
          placeholder="Exact event type"
          value={filter.type ?? ''}
        />
        <input
          aria-label="Filter device identifier"
          onChange={(event) =>
            setFilter((current) => ({
              ...current,
              deviceId: event.target.value || undefined,
            }))
          }
          placeholder="Device ID"
          value={filter.deviceId ?? ''}
        />
        <input
          aria-label="Filter session identifier"
          disabled={Boolean(sessionId)}
          onChange={(event) =>
            setFilter((current) => ({
              ...current,
              sessionId: event.target.value || undefined,
            }))
          }
          placeholder={sessionId ? 'Reopened session' : 'Session ID'}
          value={sessionId ?? filter.sessionId ?? ''}
        />
        <input
          aria-label="Filter correlation identifier"
          onChange={(event) =>
            setFilter((current) => ({
              ...current,
              correlationId: event.target.value || undefined,
            }))
          }
          placeholder="Correlation ID"
          value={filter.correlationId ?? ''}
        />
        <select
          aria-label="Filter timeline time range"
          onChange={(event) => {
            const duration = Number(event.target.value);
            setFilter((current) => ({
              ...current,
              startTime: duration ? Date.now() - duration : undefined,
              endTime: undefined,
            }));
          }}
          value=""
        >
          <option value="">Any time</option>
          <option value="60000">Last minute</option>
          <option value="300000">Last 5 minutes</option>
          <option value="3600000">Last hour</option>
        </select>
        <label className="timeline-check">
          <input
            checked={filter.errorsOnly ?? false}
            onChange={(event) =>
              setFilter((current) => ({
                ...current,
                errorsOnly: event.target.checked || undefined,
              }))
            }
            type="checkbox"
          />
          Errors only
        </label>
        <button onClick={() => setFilter({})}>Reset</button>
      </div>
      <div className="timeline-saved-filters">
        <select
          aria-label="Saved timeline filters"
          onChange={(event) => {
            const id = event.target.value;
            setSelectedSavedFilter(id);
            const saved = savedFilters.find((entry) => entry.id === id);
            if (saved) setFilter(saved.query);
          }}
          value={selectedSavedFilter}
        >
          <option value="">Saved filters</option>
          {savedFilters.map((saved) => (
            <option key={saved.id} value={saved.id}>
              {saved.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Saved filter name"
          maxLength={128}
          onChange={(event) => setFilterName(event.target.value)}
          placeholder="Filter name"
          value={filterName}
        />
        <button disabled={!filterName.trim()} onClick={() => void saveCurrentFilter()}>
          Save filter
        </button>
        <button
          disabled={!selectedSavedFilter}
          onClick={() => {
            void desktopApi.deleteSavedFilter(selectedSavedFilter).then(async () => {
              setSelectedSavedFilter('');
              await refreshMetadata();
            });
          }}
        >
          Delete filter
        </button>
        <button disabled={!selectedEventId} onClick={() => void toggleBookmark()}>
          {selectedBookmark ? 'Remove bookmark' : 'Bookmark event'}
        </button>
        {selectedDisplayedEvent?.correlationId && (
          <button
            onClick={() => {
              setFilter({ correlationId: selectedDisplayedEvent.correlationId });
            }}
          >
            Show related
          </button>
        )}
        {selectedDisplayedEvent?.parentId && (
          <button
            onClick={() => {
              void desktopApi.getEvent(selectedDisplayedEvent.parentId!).then((parent) => {
                if (parent) onSelect(parent);
              });
            }}
          >
            Open parent
          </button>
        )}
        {selectedDisplayedEvent && (
          <button onClick={() => setFilter({ parentId: selectedDisplayedEvent.id })}>
            Show children
          </button>
        )}
      </div>
      {selectedEventId && (
        <div className="timeline-annotations">
          <input
            aria-label="Event annotation"
            maxLength={10_000}
            onChange={(event) => setAnnotationBody(event.target.value)}
            placeholder="Add an annotation to the selected event"
            value={annotationBody}
          />
          <button disabled={!annotationBody.trim()} onClick={() => void addAnnotation()}>
            Annotate
          </button>
          {annotations.map((annotation) => (
            <span key={annotation.id}>
              {annotation.body}
              <button
                aria-label="Delete annotation"
                onClick={() => {
                  void desktopApi.deleteAnnotation(annotation.id).then(refreshMetadata);
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="column-head">
        <span>Time</span>
        <span>Category</span>
        <span>Event</span>
      </div>
      <div
        className="event-list virtual-event-list"
        ref={listRef}
        role="listbox"
        tabIndex={0}
        onKeyDown={(keyboardEvent) => {
          if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(keyboardEvent.key)) return;
          keyboardEvent.preventDefault();
          if (keyboardEvent.key === 'Enter') {
            if (selectedDisplayedEvent?.correlationId) {
              setFilter({ correlationId: selectedDisplayedEvent.correlationId });
            }
            return;
          }
          const delta = keyboardEvent.key === 'ArrowDown' ? 1 : -1;
          const targetIndex = Math.max(
            0,
            Math.min(displayed.length - 1, selectedIndex < 0 ? 0 : selectedIndex + delta),
          );
          const target = displayed[targetIndex];
          if (target) {
            onSelect(target);
            listRef.current?.scrollTo({
              top: Math.max(0, targetIndex * rowHeight - viewportHeight / 2),
            });
          }
        }}
        onScroll={(event) => {
          const element = event.currentTarget;
          setScrollTop(element.scrollTop);
          if (element.scrollHeight - element.scrollTop - element.clientHeight < rowHeight * 10) {
            if (hasNext) void loadMore();
          }
        }}
      >
        {displayed.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">⌁</div>
            <h2>{loading ? 'Loading events…' : 'Ready to inspect'}</h2>
            <p>{error || 'Connect the example React Native app to see its events here.'}</p>
            {!loading && !error && <code>ws://127.0.0.1:9090</code>}
          </div>
        ) : (
          <div className="virtual-event-space" style={{ height: displayed.length * rowHeight }}>
            {visibleEvents.map((event, visibleIndex) => {
              const index = startIndex + visibleIndex;
              return (
                <button
                  className={`${event.id === selectedEventId ? 'event selected' : 'event'} ${
                    bookmarks.some((bookmark) => bookmark.eventId === event.id) ? 'bookmarked' : ''
                  }`}
                  key={event.id}
                  onClick={() => onSelect(event)}
                  role="option"
                  aria-selected={event.id === selectedEventId}
                  style={{
                    height: rowHeight,
                    transform: `translateY(${index * rowHeight}px)`,
                  }}
                >
                  <time>{formatTime(event.timestamp)}</time>
                  <span className={`category ${event.category}`}>{event.category}</span>
                  <span>
                    <strong>{event.type}</strong>
                    <small>#{event.sequence}</small>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {loading && displayed.length > 0 && <div className="event-loading">Loading more…</div>}
      </div>
    </main>
  );
}

function UpcomingPanel({ view }: { view: ViewName }) {
  return (
    <main className="timeline">
      <div className="panel-header">
        <strong>{view}</strong>
      </div>
      <div className="empty">
        <div className="empty-icon">◇</div>
        <h2>{view} is planned</h2>
        <p>This inspector belongs to a later implementation phase.</p>
      </div>
    </main>
  );
}

export function App() {
  const {
    devices,
    events,
    selectedEventId,
    settings,
    setDevices,
    setSnapshot,
    setSettings,
    selectEvent,
  } = useDesktopStore();
  const [activeView, setActiveView] = useState<ViewName>('Timeline');
  const [reopenedSession, setReopenedSession] = useState<StoredSession>();
  const [selectedPagedEvent, setSelectedPagedEvent] = useState<DevToolEventEnvelope>();
  const [appVersion, setAppVersion] = useState('—');
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const selected =
    selectedPagedEvent?.id === selectedEventId
      ? selectedPagedEvent
      : findSelectedEvent(events, selectedEventId);
  const desktopApi = window.pulseRN;
  const activeInspectorCategories = inspectorCategories[activeView];
  const latestInspectorEventId = latestMatchingEventId(events, activeInspectorCategories);
  const inspectorPage = useInspectorEvents(
    activeInspectorCategories,
    latestInspectorEventId,
    reopenedSession?.sessionId,
  );
  const selectInspectorEvent = (id: string) => {
    setSelectedPagedEvent(inspectorPage.events.find((event) => event.id === id));
    selectEvent(id);
  };

  useEffect(() => {
    if (!desktopApi) return;
    void desktopApi.getSnapshot().then(setSnapshot);
    return desktopApi.onSnapshot(setSnapshot);
  }, [desktopApi, setSnapshot]);

  useEffect(() => {
    if (!desktopApi) return;
    return desktopApi.onDevices(setDevices);
  }, [desktopApi, setDevices]);

  useEffect(() => {
    if (!desktopApi) return;
    void desktopApi.getSettings().then(setSettings);
    return desktopApi.onSettings(setSettings);
  }, [desktopApi, setSettings]);

  useEffect(() => {
    if (!desktopApi) return;
    void desktopApi.getUpdateState().then((state) => setAppVersion(state.currentVersion));
  }, [desktopApi]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemTheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const resolvedTheme = settings.theme === 'system' ? systemTheme : settings.theme;
  const queuedEvents = devices.reduce(
    (total, device) => total + (device.health?.queuedEvents ?? 0),
    0,
  );
  const droppedEvents = devices.reduce(
    (total, device) => total + (device.health?.droppedEvents ?? 0),
    0,
  );
  const healthReports = devices.filter((device) => device.health !== undefined).length;
  const connectionTitle =
    devices.length === 0
      ? 'Waiting for a PulseRN SDK connection.'
      : healthReports === 0
        ? 'Connected. Upgrade the SDK to receive queue and drop diagnostics.'
        : `${queuedEvents} queued · ${droppedEvents} dropped across ${healthReports} reporting device${healthReports === 1 ? '' : 's'}.`;
  useEffect(() => {
    document.documentElement.dataset['theme'] = resolvedTheme;
    document.documentElement.dataset['density'] = settings.density;
    document.documentElement.dataset['motion'] = settings.motion;
  }, [resolvedTheme, settings.density, settings.motion]);

  if (!desktopApi) {
    return (
      <div className="startup-error">
        <div>
          <span>PulseRN failed to start</span>
          <h1>Desktop bridge unavailable</h1>
          <p>Restart the Electron development process to reload the secure preload script.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img alt="" src={resolvedTheme === 'light' ? lightAppIcon : darkAppIcon} />
          <span>PulseRN</span>
        </div>
        <button
          className={`device-pill ${droppedEvents > 0 ? 'degraded' : ''}`}
          onClick={() => setActiveView('Connections')}
          title={connectionTitle}
        >
          <span className={devices.length ? 'status online' : 'status'} />
          {devices.length === 0
            ? 'Waiting for device'
            : devices.length === 1
              ? deviceLabel(devices[0]!)
              : `${devices.length} devices connected`}
          {healthReports > 0 && (
            <small>
              {queuedEvents} queued · {droppedEvents} dropped
            </small>
          )}
        </button>
        <div className="phase-pill">v{appVersion}</div>
      </header>
      <aside className="sidebar">
        <div className="section-label">Inspect</div>
        {navItems.map((item) => (
          <button
            className={`${activeView === item.name ? 'nav active' : 'nav'} ${item.available ? '' : 'upcoming'}`}
            key={item.name}
            onClick={() => setActiveView(item.name)}
            aria-current={activeView === item.name ? 'page' : undefined}
          >
            <span>{item.icon}</span>
            {item.name}
            {!item.available && <small>Soon</small>}
          </button>
        ))}
        <div className="sidebar-footer">
          <span className={devices.length ? 'status online' : 'status'} />
          {settings.allowLanConnections ? 'LAN · token' : 'Loopback'} :{settings.devToolPort}
        </div>
      </aside>
      {activeView === 'Debugger' ? (
        <DebuggerPanel theme={resolvedTheme} />
      ) : activeView === 'Connections' ? (
        <ConnectionCenter
          devices={devices}
          onOpenSession={(session) => {
            setReopenedSession(session);
            setActiveView('Timeline');
          }}
        />
      ) : activeView === 'Timeline' ? (
        <TimelinePanel
          density={settings.density}
          liveEventId={events.at(-1)?.id}
          order={settings.timelineOrder}
          onCloseSession={() => setReopenedSession(undefined)}
          sessionId={reopenedSession?.sessionId}
          selectedEventId={selectedEventId}
          onSelect={(event) => {
            setSelectedPagedEvent(event);
            selectEvent(event.id);
          }}
        />
      ) : activeView === 'Console' ? (
        <ConsolePanel
          consoleDroppedEvents={devices.reduce(
            (total, device) => total + (device.health?.consoleDroppedEvents ?? 0),
            0,
          )}
          events={inspectorPage.events}
          selectedEventId={selectedEventId}
          onSelect={selectInspectorEvent}
        />
      ) : activeView === 'Network' ? (
        <NetworkPanel
          events={inspectorPage.events}
          sessionId={reopenedSession?.sessionId}
          selectedEventId={selectedEventId}
          onSelect={selectInspectorEvent}
        />
      ) : activeView === 'Redux' ? (
        <ReduxPanel
          events={inspectorPage.events}
          selectedEventId={selectedEventId}
          onSelect={selectInspectorEvent}
        />
      ) : activeView === 'Navigation' ? (
        <NavigationPanel
          events={inspectorPage.events}
          selectedEventId={selectedEventId}
          onSelect={selectInspectorEvent}
        />
      ) : activeView === 'Performance' ? (
        <PerformancePanel
          events={inspectorPage.events}
          selectedEventId={selectedEventId}
          onSelect={selectInspectorEvent}
          thresholds={settings}
          onThresholdChange={async (patch) => setSettings(await desktopApi.updateSettings(patch))}
        />
      ) : activeView === 'Storage' ? (
        <StoragePanel devices={devices} />
      ) : activeView === 'Errors' ? (
        <ErrorsPanel
          events={inspectorPage.events}
          selectedEventId={selectedEventId}
          onSelect={selectInspectorEvent}
        />
      ) : activeView === 'Settings' ? (
        <SettingsPanel
          deviceCount={devices.length}
          eventCount={events.length}
          resolvedTheme={resolvedTheme}
          settings={settings}
          onChange={async (patch) => setSettings(await desktopApi.updateSettings(patch))}
        />
      ) : activeView === 'MCP' ? (
        <McpPanel
          settings={settings}
          onChange={async (patch) => setSettings(await desktopApi.updateSettings(patch))}
        />
      ) : activeView === 'Sessions' ? (
        <SessionsPanel
          onOpen={(session) => {
            setReopenedSession(session);
            setActiveView('Timeline');
          }}
        />
      ) : (
        <UpcomingPanel view={activeView} />
      )}
      {inspectorCategories[activeView] && (
        <div className="inspector-pagination">
          <span>
            {inspectorPage.events.length} of {inspectorPage.total}
          </span>
          {inspectorPage.error && <span className="pagination-error">{inspectorPage.error}</span>}
          <button
            disabled={!inspectorPage.hasPrevious || inspectorPage.loading}
            onClick={() => void inspectorPage.loadNewer()}
          >
            Load newer
          </button>
          <button
            disabled={!inspectorPage.hasNext || inspectorPage.loading}
            onClick={() => void inspectorPage.loadMore()}
          >
            {inspectorPage.loading
              ? 'Loading…'
              : inspectorPage.hasNext
                ? 'Load older'
                : 'All loaded'}
          </button>
        </div>
      )}
      {activeView !== 'Debugger' && (
        <EventDetails
          event={selected}
          onSelect={(id) => {
            void desktopApi.getEvent(id).then((event) => {
              if (event) setSelectedPagedEvent(event);
              selectEvent(id);
            });
          }}
        />
      )}
    </div>
  );
}
