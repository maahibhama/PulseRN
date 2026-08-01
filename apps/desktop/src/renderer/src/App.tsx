import type { DevToolEventCategory, DevToolEventEnvelope } from '@pulse-rn/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConsolePanel } from './ConsolePanel.js';
import { DebuggerPanel } from './DebuggerPanel.js';
import { EventDetails } from './EventDetails.js';
import { ErrorsPanel } from './ErrorsPanel.js';
import { NetworkPanel } from './NetworkPanel.js';
import { NavigationPanel } from './NavigationPanel.js';
import { PerformancePanel } from './PerformancePanel.js';
import { ReduxPanel } from './ReduxPanel.js';
import { SettingsPanel } from './SettingsPanel.js';
import { SessionsPanel } from './SessionsPanel.js';
import { StoragePanel } from './StoragePanel.js';
import darkAppIcon from '../../../resources/pulse-rn-app-icon-dark.png';
import lightAppIcon from '../../../resources/pulse-rn-app-icon-light.png';
import { deviceLabel, findSelectedEvent, useDesktopStore } from './store.js';
import { useInspectorEvents } from './useInspectorEvents.js';

type ViewName =
  | 'Timeline'
  | 'Console'
  | 'Network'
  | 'Redux'
  | 'Navigation'
  | 'Performance'
  | 'Storage'
  | 'Errors'
  | 'Debugger'
  | 'Sessions'
  | 'Settings';

const navItems: { name: ViewName; icon: string; available: boolean }[] = [
  { name: 'Timeline', icon: '⌁', available: true },
  { name: 'Console', icon: '>_', available: true },
  { name: 'Network', icon: '⇄', available: true },
  { name: 'Redux', icon: '◇', available: true },
  { name: 'Navigation', icon: '→', available: true },
  { name: 'Performance', icon: '⌁', available: true },
  { name: 'Storage', icon: '▤', available: true },
  { name: 'Errors', icon: '△', available: true },
  { name: 'Debugger', icon: '⏵', available: true },
  { name: 'Sessions', icon: '◫', available: true },
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
}: {
  density: 'comfortable' | 'compact';
  liveEventId?: string;
  selectedEventId?: string;
  onSelect(event: DevToolEventEnvelope): void;
  order: 'newest' | 'oldest';
}) {
  const desktopApi = window.pulseRN;
  const [paused, setPaused] = useState(false);
  const [events, setEvents] = useState<DevToolEventEnvelope[]>([]);
  const [cursor, setCursor] =
    useState<Awaited<ReturnType<typeof desktopApi.queryEvents>>['nextCursor']>();
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clearedAt, setClearedAt] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const listRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const rowHeight = density === 'compact' ? 36 : 42;

  const loadFirstPage = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError('');
    try {
      const page = await desktopApi.queryEvents({ limit: 250, order });
      if (generation !== requestGeneration.current) return;
      setEvents(page.events);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
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
  }, [desktopApi, order]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore || !cursor) return;
    setLoading(true);
    setError('');
    try {
      const page = await desktopApi.queryEvents({ cursor, limit: 250, order });
      setEvents((current) => {
        const ids = new Set(current.map((event) => event.id));
        return [...current, ...page.events.filter((event) => !ids.has(event.id))];
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setTotal(page.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load more events.');
    } finally {
      setLoading(false);
    }
  }, [cursor, desktopApi, hasMore, loading, order]);

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

  const clearView = () => {
    setClearedAt(Date.now());
    setEvents([]);
    setCursor(undefined);
    setHasMore(false);
    setTotal(0);
  };

  return (
    <main className="timeline">
      <div className="panel-header">
        <div>
          <strong>Unified timeline</strong>
          <span>
            {displayed.length} loaded · {total} total
          </span>
        </div>
        <div className="actions">
          <button className={paused ? 'control-active' : ''} onClick={() => setPaused(!paused)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={clearView}>Clear</button>
        </div>
      </div>
      <div className="column-head">
        <span>Time</span>
        <span>Category</span>
        <span>Event</span>
      </div>
      <div
        className="event-list virtual-event-list"
        ref={listRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          setScrollTop(element.scrollTop);
          if (element.scrollHeight - element.scrollTop - element.clientHeight < rowHeight * 10) {
            void loadMore();
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
                  className={event.id === selectedEventId ? 'event selected' : 'event'}
                  key={event.id}
                  onClick={() => onSelect(event)}
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
  const [selectedPagedEvent, setSelectedPagedEvent] = useState<DevToolEventEnvelope>();
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const selected =
    selectedPagedEvent?.id === selectedEventId
      ? selectedPagedEvent
      : findSelectedEvent(events, selectedEventId);
  const desktopApi = window.pulseRN;
  const activeInspectorCategories = inspectorCategories[activeView];
  const latestEvent = events.at(-1);
  const inspectorPage = useInspectorEvents(
    activeInspectorCategories,
    latestEvent && activeInspectorCategories?.includes(latestEvent.category)
      ? latestEvent.id
      : undefined,
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
  }, [resolvedTheme, settings.density]);

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
        <div
          className={`device-pill ${droppedEvents > 0 ? 'degraded' : ''}`}
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
        </div>
        <div className="phase-pill">Phase 9 · JavaScript Debugger</div>
      </header>
      <aside className="sidebar">
        <div className="section-label">Inspect</div>
        {navItems.map((item) => (
          <button
            className={`${activeView === item.name ? 'nav active' : 'nav'} ${item.available ? '' : 'upcoming'}`}
            key={item.name}
            onClick={() => setActiveView(item.name)}
          >
            <span>{item.icon}</span>
            {item.name}
            {!item.available && <small>Soon</small>}
          </button>
        ))}
        <div className="sidebar-footer">
          <span className={devices.length ? 'status online' : 'status'} />
          WebSocket :9090
        </div>
      </aside>
      {activeView === 'Debugger' ? (
        <DebuggerPanel theme={resolvedTheme} />
      ) : activeView === 'Timeline' ? (
        <TimelinePanel
          density={settings.density}
          liveEventId={events.at(-1)?.id}
          order={settings.timelineOrder}
          selectedEventId={selectedEventId}
          onSelect={(event) => {
            setSelectedPagedEvent(event);
            selectEvent(event.id);
          }}
        />
      ) : activeView === 'Console' ? (
        <ConsolePanel
          events={inspectorPage.events}
          selectedEventId={selectedEventId}
          onSelect={selectInspectorEvent}
        />
      ) : activeView === 'Network' ? (
        <NetworkPanel
          events={inspectorPage.events}
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
          resolvedTheme={resolvedTheme}
          settings={settings}
          onChange={async (patch) => setSettings(await desktopApi.updateSettings(patch))}
        />
      ) : activeView === 'Sessions' ? (
        <SessionsPanel />
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
            disabled={!inspectorPage.hasMore || inspectorPage.loading}
            onClick={() => void inspectorPage.loadMore()}
          >
            {inspectorPage.loading
              ? 'Loading…'
              : inspectorPage.hasMore
                ? 'Load older'
                : 'All loaded'}
          </button>
        </div>
      )}
      {activeView !== 'Debugger' && <EventDetails event={selected} />}
    </div>
  );
}
