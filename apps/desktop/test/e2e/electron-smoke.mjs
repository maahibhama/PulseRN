import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import electronPath from 'electron';
import WebSocket from 'ws';

const desktopDirectory = join(import.meta.dirname, '../..');
const desktopVersion = JSON.parse(
  readFileSync(join(desktopDirectory, 'package.json'), 'utf8'),
).version;
const userDataDirectory = mkdtempSync(join(tmpdir(), 'pulse-rn-electron-e2e-'));
const debuggingPort = 19_223;
const serverPort = 19_090;
const seededEventCount = 100_000;

function seedLargeLegacyDatabase() {
  const database = new DatabaseSync(join(userDataDirectory, 'pulse-rn.sqlite'));
  const startedAt = Date.now() - seededEventCount;
  database.exec(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      envelope_json TEXT NOT NULL
    );
    BEGIN IMMEDIATE;
  `);
  const insert = database.prepare(`
    INSERT INTO events
      (id, session_id, device_id, timestamp, sequence, category, type, envelope_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (let sequence = 0; sequence < seededEventCount; sequence += 1) {
    const event = {
      id: `seed-event-${sequence.toString().padStart(6, '0')}`,
      protocolVersion: '1.0.0',
      sessionId: 'seed-session',
      deviceId: 'seed-device',
      appId: 'dev.pulsern.seed',
      timestamp: startedAt + sequence,
      sequence,
      category: 'console',
      type: 'console.log',
      payload: {
        level: 'log',
        arguments: [`seed event ${sequence}`],
        message: `seed event ${sequence}`,
      },
    };
    insert.run(
      event.id,
      event.sessionId,
      event.deviceId,
      event.timestamp,
      event.sequence,
      event.category,
      event.type,
      JSON.stringify(event),
    );
  }
  database.exec('COMMIT;');
  database.close();
}

seedLargeLegacyDatabase();

const app = spawn(
  electronPath,
  [
    desktopDirectory,
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${userDataDirectory}`,
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  ],
  {
    cwd: desktopDirectory,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      PULSE_RN_E2E_SERVER_PORT: String(serverPort),
      PULSE_RN_E2E_USER_DATA_DIR: userDataDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let output = '';
app.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
app.stderr.on('data', (chunk) => {
  output += chunk.toString();
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function retry(action, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await action();
      if (result !== undefined && result !== false) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out.${lastError ? ` ${lastError.message}` : ''}`);
}

async function openCdp() {
  const target = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
    const targets = await response.json();
    return targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
  }, 'Electron renderer discovery');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  let requestId = 0;
  const pending = new Map();
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  await send('Runtime.enable');
  await send('HeapProfiler.enable');
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? 'Renderer evaluation failed',
      );
    }
    return result.result.value;
  };
  return { evaluate, send, socket };
}

async function connectExampleClient() {
  const socket = await retry(
    () =>
      new Promise((resolve, reject) => {
        const candidate = new WebSocket(`ws://127.0.0.1:${serverPort}`);
        candidate.once('open', () => resolve(candidate));
        candidate.once('error', reject);
      }),
    'PulseRN WebSocket server',
  );
  socket.send(
    JSON.stringify({
      kind: 'client-hello',
      supportedProtocolVersions: ['1.0.0'],
      sessionId: 'e2e-session',
      deviceId: 'e2e-device',
      appId: 'dev.pulsern.e2e',
      device: {
        name: 'Acceptance test',
        platform: 'ios',
        appName: 'PulseRN E2E',
        sdkVersion: '0.2.1',
      },
    }),
  );
  await new Promise((resolve, reject) => {
    socket.once('message', (raw) => {
      const response = JSON.parse(raw.toString());
      if (response.kind === 'server-hello' && response.accepted) resolve();
      else reject(new Error(`Handshake rejected: ${raw.toString()}`));
    });
    socket.once('error', reject);
  });
  return socket;
}

function events(count) {
  const startedAt = Date.now();
  return Array.from({ length: count }, (_, sequence) => {
    const repeated = sequence >= count - 3;
    return {
      id: `e2e-event-${sequence.toString().padStart(4, '0')}`,
      protocolVersion: '1.0.0',
      sessionId: 'e2e-session',
      deviceId: 'e2e-device',
      appId: 'dev.pulsern.e2e',
      timestamp: startedAt + sequence,
      sequence,
      category: 'console',
      type: 'console.log',
      payload: {
        level: 'log',
        arguments: [repeated ? 'repeated acceptance event' : `acceptance event ${sequence}`],
        message: repeated ? 'repeated acceptance event' : `acceptance event ${sequence}`,
        ...(repeated ? { redacted: true } : {}),
      },
    };
  });
}

function inspectorEvents() {
  const timestamp = Date.now() + 1_000;
  const envelope = (category, type, sequence, payload) => ({
    id: `e2e-${category}`,
    protocolVersion: '1.0.0',
    sessionId: 'e2e-session',
    deviceId: 'e2e-device',
    appId: 'dev.pulsern.e2e',
    timestamp: timestamp + sequence,
    sequence: 2_000 + sequence,
    category,
    type,
    correlationId: 'acceptance-flow',
    ...(sequence > 1 ? { parentId: 'e2e-network' } : {}),
    payload,
  });
  return [
    envelope('network', 'network.request', 1, {
      requestId: 'request-1',
      transport: 'fetch',
      method: 'GET',
      url: 'https://example.com/health',
      query: {},
      requestHeaders: {},
      status: 200,
      responseHeaders: {},
      startedAt: timestamp,
      endedAt: timestamp + 20,
      duration: 20,
    }),
    envelope('redux', 'redux.action', 2, {
      storeId: 'main',
      actionType: 'e2e/accepted',
      actionCategory: 'acceptance',
      action: { type: 'e2e/accepted' },
      previousState: { accepted: false },
      nextState: { accepted: true },
      stateDiff: [{ path: '$.accepted', kind: 'changed', before: false, after: true }],
      changedPaths: ['$.accepted'],
      stateSize: {
        previousBytes: 18,
        nextBytes: 17,
        warningThresholdBytes: 16,
        truncated: false,
      },
      correlations: {
        route: 'Acceptance',
        requestId: 'request-1',
        errorId: 'e2e-error',
        performanceEventId: 'e2e-performance',
      },
      reducerDuration: 1,
    }),
    envelope('navigation', 'navigation.state', 3, {
      navigatorId: 'root',
      source: 'manual',
      lifecycle: 'state',
      action: 'navigate',
      previousRoute: { key: 'home-1', name: 'Home', params: { tab: 'overview' } },
      currentRoute: { key: 'acceptance-1', name: 'Acceptance', params: { tab: 'details' } },
      previousRouteDuration: 1_250,
      routePath: ['RootStack', 'Acceptance'],
      routeTree: [
        {
          navigatorId: 'root',
          route: { key: 'root-stack', name: 'RootStack' },
          active: true,
          depth: 0,
        },
        {
          navigatorId: 'root/root-stack',
          parentNavigatorId: 'root',
          route: { key: 'acceptance-1', name: 'Acceptance' },
          active: true,
          depth: 1,
        },
      ],
      parameterDiff: [{ path: '$.tab', kind: 'changed', before: 'overview', after: 'details' }],
      actionGroup: 'forward',
      warnings: ['incomplete_tracking'],
      integrationMetadata: { integration: 'acceptance' },
      correlations: {
        requestId: 'e2e-network',
        reduxEventId: 'e2e-redux',
        performanceEventId: 'e2e-performance',
        errorId: 'e2e-error',
      },
    }),
    envelope('performance', 'performance.metric', 4, {
      metric: 'js_fps',
      name: 'JavaScript FPS',
      value: 42,
      unit: 'fps',
      approximate: true,
      provenance: 'javascript',
      sampling: {
        intervalMs: 1_000,
        expectedSamples: 9,
        lostSamples: 1,
        captureRate: 0.9,
      },
    }),
    envelope('error', 'error.captured', 5, {
      source: 'manual',
      name: 'AcceptanceError',
      message: 'E2E inspector validation',
      fatal: false,
      context: [],
    }),
    {
      ...envelope('network', 'network.request-start', 6, {
        phase: 'start',
        requestId: 'request-in-flight',
        transport: 'xhr',
        method: 'GET',
        url: 'https://example.com/download',
        timestamp: timestamp + 6,
        startedAt: timestamp + 6,
        timingAccuracy: 'measured',
      }),
      id: 'e2e-network-start',
      correlationId: 'network-live',
    },
    {
      ...envelope('performance', 'performance.capability', 8, {
        metric: 'capability',
        name: 'native cpu',
        value: 0,
        unit: 'count',
        approximate: false,
        provenance: 'runtime',
        capability: {
          name: 'native_cpu',
          status: 'unavailable',
          reason: 'Native CPU profiling is outside SDK capability.',
        },
      }),
      id: 'e2e-performance-capability',
      correlationId: 'performance-capability',
    },
    {
      ...envelope('network', 'network.request-progress', 7, {
        phase: 'progress',
        requestId: 'request-in-flight',
        transport: 'xhr',
        method: 'GET',
        url: 'https://example.com/download',
        timestamp: timestamp + 7,
        startedAt: timestamp + 6,
        loadedBytes: 512,
        totalBytes: 1_024,
        timingAccuracy: 'approximate',
      }),
      id: 'e2e-network-progress',
      correlationId: 'network-live',
    },
  ];
}

let cdp;
let client;
try {
  cdp = await openCdp();
  await retry(
    async () => (await cdp.evaluate("document.querySelector('.brand')?.textContent")) === 'PulseRN',
    'PulseRN renderer startup',
  );

  const security = await cdp.evaluate(`({
    requireType: typeof globalThis.require,
    processType: typeof globalThis.process,
    apiType: typeof window.pulseRN,
    queryType: typeof window.pulseRN?.queryEvents
  })`);
  assert(security.requireType === 'undefined', 'Renderer unexpectedly exposes require().');
  assert(security.processType === 'undefined', 'Renderer unexpectedly exposes Node process.');
  assert(security.apiType === 'object', 'Secure preload API is unavailable.');
  assert(security.queryType === 'function', 'Validated event query API is unavailable.');

  client = await connectExampleClient();
  client.send(
    JSON.stringify({
      kind: 'client-health',
      sentAt: Date.now() - 12,
      queuedEvents: 3,
      droppedEvents: 1,
      oversizedEvents: 0,
      queueOverflowEvents: 1,
      consoleDroppedEvents: 2,
      sentEvents: 0,
      sentBatches: 0,
      reconnectAttempts: 0,
      socketBufferedBytes: 0,
      clockOffsetMs: -4,
    }),
  );
  const generatedEvents = events(600);
  client.send(JSON.stringify({ kind: 'event-batch', events: generatedEvents.slice(0, 500) }));
  client.send(JSON.stringify({ kind: 'event-batch', events: generatedEvents.slice(500) }));
  client.send(JSON.stringify({ kind: 'event-batch', events: inspectorEvents() }));

  const page = await retry(async () => {
    const result = await cdp.evaluate(
      "window.pulseRN.queryEvents({ categories: ['console'], limit: 100, order: 'newest' })",
    );
    return result.total === seededEventCount + 600 ? result : undefined;
  }, 'Persisted event ingestion');
  assert(
    page.events.length === 100 && page.hasNext && !page.hasPrevious,
    'Cursor page was not bounded correctly.',
  );
  assert(page.total === seededEventCount + 600, 'The 100,000-event session was not retained.');

  const older = await cdp.evaluate(
    `window.pulseRN.queryEvents(${JSON.stringify({
      categories: ['console'],
      cursor: page.nextCursor,
      direction: 'forward',
      limit: 100,
      order: 'newest',
    })})`,
  );
  assert(older.hasPrevious, 'Older cursor pages did not expose backward navigation.');
  const newer = await cdp.evaluate(
    `window.pulseRN.queryEvents(${JSON.stringify({
      categories: ['console'],
      cursor: older.previousCursor,
      direction: 'backward',
      limit: 100,
      order: 'newest',
    })})`,
  );
  assert(
    newer.events[0]?.id === page.events[0]?.id,
    'Backward cursor navigation did not return the adjacent newer page.',
  );
  const invalidIpcRejected = await cdp.evaluate(
    'window.pulseRN.queryEvents({ limit: 5001 }).then(() => false, () => true)',
  );
  assert(invalidIpcRejected, 'Preload accepted an invalid event query.');
  const advancedFilter = await cdp.evaluate(
    "window.pulseRN.queryEvents({ correlationId: 'acceptance-flow', limit: 20 })",
  );
  assert(advancedFilter.total === 5, 'Database-backed correlation filtering failed.');
  const textFilter = await cdp.evaluate(
    "window.pulseRN.queryEvents({ text: 'E2E inspector validation', limit: 20 })",
  );
  assert(textFilter.total === 1, 'Database-backed text filtering failed.');
  const metadataRoundTrip = await cdp.evaluate(`(async () => {
    const saved = await window.pulseRN.saveEventFilter('Acceptance flow', {
      correlationId: 'acceptance-flow'
    });
    const bookmark = await window.pulseRN.addBookmark('e2e-network', 'Acceptance request');
    const annotation = await window.pulseRN.saveAnnotation(
      'e2e-network',
      'Validated by Electron acceptance.'
    );
    return {
      saved,
      bookmark,
      annotation,
      filters: await window.pulseRN.listSavedFilters(),
      bookmarks: await window.pulseRN.listBookmarks('e2e-session'),
      annotations: await window.pulseRN.listAnnotations('e2e-network')
    };
  })()`);
  assert(metadataRoundTrip.filters.length === 1, 'Saved filters were not persisted.');
  assert(metadataRoundTrip.bookmarks.length === 1, 'Bookmarks were not persisted.');
  assert(metadataRoundTrip.annotations.length === 1, 'Annotations were not persisted.');

  await cdp.evaluate(
    "[...document.querySelectorAll('.nav')].find((button) => button.textContent.includes('Timeline'))?.click()",
  );
  await retry(
    async () =>
      (await cdp.evaluate("document.querySelector('.timeline-filters') !== null")) === true,
    'Unified timeline controls',
  );
  await cdp.evaluate(`(() => {
    const input = document.querySelector('[aria-label="Filter correlation identifier"]');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set;
    setter.call(input, 'acceptance-flow');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await retry(
    async () =>
      (await cdp.evaluate("document.querySelector('.panel-header span')?.textContent"))?.includes(
        '5 total',
      ),
    'Timeline correlation filter',
  );

  await cdp.evaluate(
    "[...document.querySelectorAll('.nav')].find((button) => button.textContent.includes('Console'))?.click()",
  );
  await retry(
    async () =>
      (await cdp.evaluate("document.querySelector('.console-header strong')?.textContent")) ===
      'Console',
    'Console inspector navigation',
  );
  await retry(
    async () =>
      (await cdp.evaluate("document.querySelector('.inspector-pagination span')?.textContent")) ===
      `250 of ${seededEventCount + 600}`,
    'Inspector pagination rendering',
  );
  await retry(
    async () =>
      (await cdp.evaluate("document.querySelector('.repeat-count')?.textContent")) === '×3',
    'Consecutive console repeat collapsing',
  );
  assert(
    (await cdp.evaluate("document.querySelector('.redaction-badge')?.textContent")) === 'Redacted',
    'Console redaction indicator was missing.',
  );
  assert(
    (await cdp.evaluate("document.querySelector('.console-drop-warning')?.textContent")).includes(
      '2 console events',
    ),
    'Console transport drop diagnostics were missing.',
  );
  await cdp.evaluate(`(() => {
    const input = document.querySelector('[aria-label="Search console logs"]');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    ).set;
    setter.call(input, 'repeated\\nacceptance');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await retry(
    async () => (await cdp.evaluate("document.querySelectorAll('.repeat-count').length")) === 1,
    'Multiline console search',
  );

  await cdp.send('HeapProfiler.collectGarbage');
  const heapBefore = await cdp.send('Runtime.getHeapUsage');
  for (let pageIndex = 0; pageIndex < 9; pageIndex += 1) {
    await cdp.evaluate(
      "[...document.querySelectorAll('.inspector-pagination button')].find((button) => button.textContent.includes('older'))?.click()",
    );
    const expectedLoaded = Math.min((pageIndex + 2) * 250, 2_000);
    await retry(
      async () =>
        (await cdp.evaluate(
          "document.querySelector('.inspector-pagination span')?.textContent",
        )) === `${expectedLoaded} of ${seededEventCount + 600}`,
      `Inspector page ${pageIndex + 1}`,
    );
  }
  const boundedRenderer = await cdp.evaluate(`({
    label: document.querySelector('.inspector-pagination span')?.textContent,
    rows: document.querySelectorAll('.bounded-virtual-row').length
  })`);
  assert(
    boundedRenderer.label === `2000 of ${seededEventCount + 600}`,
    'Renderer event window exceeded or failed to reach its 2,000-event bound.',
  );
  assert(boundedRenderer.rows <= 250, 'Virtualized inspector mounted more than 250 event rows.');
  await cdp.send('HeapProfiler.collectGarbage');
  const heapAfter = await cdp.send('Runtime.getHeapUsage');
  assert(
    heapAfter.usedSize - heapBefore.usedSize < 150 * 1024 * 1024,
    'Renderer heap grew by more than 150 MiB while traversing the large session.',
  );

  await cdp.evaluate(
    "[...document.querySelectorAll('.nav')].find((button) => button.textContent.includes('Connections'))?.click()",
  );
  await retry(
    async () =>
      (await cdp.evaluate("document.querySelector('.connection-device strong')?.textContent")) ===
      'Acceptance test',
    'Connection center active device',
  );
  const connectionDiagnostics = await cdp.evaluate(`({
    text: document.querySelector('.connection-device')?.textContent,
    summary: document.querySelector('.connection-summary')?.textContent
  })`);
  assert(connectionDiagnostics.text.includes('loopback'), 'Connection trust status was missing.');
  assert(connectionDiagnostics.summary.includes('3'), 'Queue pressure was missing.');

  for (const [view, selector] of [
    ['Network', '.network-panel .bounded-virtual-row'],
    ['Redux', '.redux-panel .bounded-virtual-row'],
    ['Navigation', '.navigation-panel .bounded-virtual-row'],
    ['Performance', '.performance-panel .bounded-virtual-row'],
    ['Errors', '.errors-panel .bounded-virtual-row'],
  ]) {
    await cdp.evaluate(
      `[...document.querySelectorAll('.nav')].find((button) => button.textContent.includes(${JSON.stringify(view)}))?.click()`,
    );
    await retry(
      async () =>
        (await cdp.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)) > 0,
      `${view} virtualized inspector`,
    );
    const rowCount = await cdp.evaluate(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
    );
    assert(rowCount <= 250, `${view} mounted more than 250 event rows.`);
    if (view === 'Network') {
      assert(
        (await cdp.evaluate(
          "[...document.querySelectorAll('.network-status')].some((entry) => entry.textContent === 'LIVE')",
        )) === true,
        'Network inspector did not retain an in-flight lifecycle request.',
      );
      assert(
        (await cdp.evaluate("document.querySelector('.waterfall-track i') !== null")) === true,
        'Network waterfall timing was not rendered.',
      );
    }
    if (view === 'Redux') {
      assert(
        (await cdp.evaluate("document.querySelector('.redux-entry')?.textContent")).includes(
          'acceptance',
        ),
        'Redux action category was not rendered.',
      );
      await cdp.evaluate("document.querySelector('.redux-entry')?.click()");
      await retry(
        async () =>
          (await cdp.evaluate("document.querySelector('.redux-state-warning') !== null")) === true,
        'Redux state size warning',
      );
      assert(
        (await cdp.evaluate("document.querySelector('.redux-correlations')?.textContent")).includes(
          'Acceptance',
        ),
        'Redux correlation context was not rendered.',
      );
    }
    if (view === 'Navigation') {
      assert(
        (await cdp.evaluate("document.querySelector('.navigation-duration-chart i') !== null")) ===
          true,
        'Navigation duration chart was not rendered.',
      );
      await cdp.evaluate("document.querySelector('.navigation-entry')?.click()");
      await retry(
        async () =>
          (await cdp.evaluate("document.querySelector('.route-tree .active') !== null")) === true,
        'Navigation route tree',
      );
      assert(
        (await cdp.evaluate("document.querySelector('.route-breadcrumb')?.textContent")).includes(
          'Acceptance',
        ),
        'Complete navigation route path was not rendered.',
      );
      assert(
        (await cdp.evaluate("document.querySelector('.parameter-diff')?.textContent")).includes(
          '$.tab',
        ),
        'Navigation parameter diff was not rendered.',
      );
    }
    if (view === 'Performance') {
      assert(
        (
          await cdp.evaluate("document.querySelector('.performance-capabilities')?.textContent")
        ).includes('native cpu unavailable'),
        'Missing performance capability was not reported.',
      );
      assert(
        (await cdp.evaluate(
          "document.querySelector('.performance-entry.threshold-exceeded') !== null",
        )) === true,
        'Configured performance threshold was not highlighted.',
      );
      const performanceSummary = await cdp.evaluate(
        "document.querySelector('.performance-summary')?.textContent",
      );
      assert(
        performanceSummary.includes('10.0%'),
        `Performance sampling loss was not rendered: ${performanceSummary}`,
      );
    }
  }

  client.close();
  client = await connectExampleClient();
  const reconnectEvent = events(1)[0];
  reconnectEvent.id = 'e2e-reconnect-event';
  reconnectEvent.sequence = 10_000;
  reconnectEvent.timestamp = Date.now() + 10_000;
  client.send(JSON.stringify({ kind: 'event-batch', events: [reconnectEvent] }));
  await retry(async () => {
    const result = await cdp.evaluate(
      "window.pulseRN.queryEvents({ categories: ['console'], limit: 1, order: 'newest' })",
    );
    return result.events[0]?.id === 'e2e-reconnect-event';
  }, 'WebSocket reconnect ingestion');

  await cdp.evaluate(
    "[...document.querySelectorAll('.nav')].find((button) => button.textContent.includes('Sessions'))?.click()",
  );
  await retry(
    async () =>
      (await cdp.evaluate("document.querySelector('.session-entry strong')?.textContent")) ===
      'PulseRN E2E',
    'Stored session browser',
  );
  await cdp.evaluate(
    "[...document.querySelectorAll('.session-entry')].find((row) => row.textContent.includes('PulseRN E2E'))?.querySelector('button')?.click()",
  );
  await retry(
    async () =>
      (await cdp.evaluate("document.querySelector('.panel-header span')?.textContent"))?.includes(
        '609 total · reopened session',
      ),
    'Stored session reopen',
  );

  await cdp.evaluate(
    "[...document.querySelectorAll('.nav')].find((button) => button.textContent.includes('Settings'))?.click()",
  );
  await retry(
    async () =>
      (await cdp.evaluate("document.querySelector('.settings-card strong')?.textContent")) !==
      undefined,
    'Settings navigation',
  );
  const settings = await cdp.evaluate(
    'window.pulseRN.updateSettings({ eventRetentionDays: 7, maxStoredEvents: 200000 })',
  );
  assert(settings.eventRetentionDays === 7, 'Retention settings did not cross preload.');
  assert(settings.maxStoredEvents === 200_000, 'Event limit did not cross preload.');
  const connectionInfo = await cdp.evaluate('window.pulseRN.getConnectionInfo()');
  assert(connectionInfo.mode === 'loopback', 'Loopback is not the default connection mode.');
  assert(connectionInfo.port === serverPort, 'Effective debugger server port was not reported.');
  assert(
    connectionInfo.requiresAuth === false,
    'Loopback unexpectedly requires LAN authentication.',
  );
  assert(connectionInfo.tls.enabled === false, 'TLS was unexpectedly enabled by default.');
  assert(
    connectionInfo.tls.configured === false,
    'A fresh profile unexpectedly reported TLS credentials.',
  );
  assert(connectionInfo.pairing === undefined, 'Loopback unexpectedly created a pairing code.');
  assert(
    connectionInfo.trustedDevices.length === 0,
    'A fresh profile unexpectedly contained trusted LAN devices.',
  );
  const updateState = await cdp.evaluate('window.pulseRN.getUpdateState()');
  assert(updateState.enabled === false, 'Development build unexpectedly enabled installation.');
  assert(updateState.status === 'disabled', 'Development updater did not fail closed.');
  assert(
    updateState.currentVersion === desktopVersion,
    'Application version did not cross the update preload boundary.',
  );
  const maintenance = await cdp.evaluate('window.pulseRN.runDatabaseMaintenance()');
  assert(
    maintenance.retainedEvents === seededEventCount + 609,
    'Database maintenance lost retained events.',
  );

  console.log('PulseRN Electron acceptance test passed.');
} catch (error) {
  console.error(output);
  throw error;
} finally {
  client?.terminate();
  cdp?.socket.terminate();
  app.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => app.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (!exited) app.kill('SIGKILL');
  app.stdout.destroy();
  app.stderr.destroy();
  rmSync(userDataDirectory, { recursive: true, force: true });
}
