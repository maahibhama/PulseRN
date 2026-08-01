import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electronPath from 'electron';
import WebSocket from 'ws';

const desktopDirectory = join(import.meta.dirname, '../..');
const userDataDirectory = mkdtempSync(join(tmpdir(), 'pulse-rn-electron-e2e-'));
const debuggingPort = 19_223;
const serverPort = 19_090;
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
  return { evaluate, socket };
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
  return Array.from({ length: count }, (_, sequence) => ({
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
      arguments: [`acceptance event ${sequence}`],
      message: `acceptance event ${sequence}`,
    },
  }));
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
  const generatedEvents = events(600);
  client.send(JSON.stringify({ kind: 'event-batch', events: generatedEvents.slice(0, 500) }));
  client.send(JSON.stringify({ kind: 'event-batch', events: generatedEvents.slice(500) }));

  const page = await retry(async () => {
    const result = await cdp.evaluate(
      "window.pulseRN.queryEvents({ categories: ['console'], limit: 100, order: 'newest' })",
    );
    return result.total === 600 ? result : undefined;
  }, 'Persisted event ingestion');
  assert(page.events.length === 100 && page.hasMore, 'Cursor page was not bounded correctly.');

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
      '250 of 600',
    'Inspector pagination rendering',
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
    'window.pulseRN.updateSettings({ eventRetentionDays: 7, maxStoredEvents: 50000 })',
  );
  assert(settings.eventRetentionDays === 7, 'Retention settings did not cross preload.');
  assert(settings.maxStoredEvents === 50_000, 'Event limit did not cross preload.');
  const maintenance = await cdp.evaluate('window.pulseRN.runDatabaseMaintenance()');
  assert(maintenance.retainedEvents === 600, 'Database maintenance lost retained events.');

  console.log('PulseRN Electron acceptance test passed.');
} catch (error) {
  console.error(output);
  throw error;
} finally {
  client?.close();
  cdp?.socket.close();
  app.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => app.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  rmSync(userDataDirectory, { recursive: true, force: true });
}
