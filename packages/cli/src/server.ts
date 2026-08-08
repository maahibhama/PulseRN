import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import { EventDatabase } from '../../../apps/desktop/src/main/database.js';
import { SessionManager } from '../../../apps/desktop/src/main/session-manager.js';
import { SettingsStore } from '../../../apps/desktop/src/main/settings.js';
import {
  AppearanceStore,
  themeDefinitionSchema,
} from '../../../apps/desktop/src/main/appearance.js';
import { PairingStore } from '../../../apps/desktop/src/main/pairing-store.js';
import { TlsCertificateStore } from '../../../apps/desktop/src/main/tls-certificate.js';
import { DebuggerManager } from '../../../apps/desktop/src/main/debugger-manager.js';
import { DiagnosticService } from '../../../apps/desktop/src/main/diagnostic-service.js';
import { McpBridge } from '../../../apps/desktop/src/main/mcp-bridge.js';
import { DevToolWebSocketServer } from '../../../apps/desktop/src/main/websocket-server.js';
import { NativeLogManager } from '../../../apps/desktop/src/main/native-log-manager.js';
import { AnalyticsClient } from '../../../apps/desktop/src/main/analytics.js';
import { createDemoSession } from '../../../apps/desktop/src/main/demo-session.js';
import {
  createSessionArchive,
  decodeSessionArchive,
  encodeSessionArchive,
  importSessionArchive,
} from '../../../apps/desktop/src/main/session-archive.js';
import {
  createCurlCommand,
  createSanitizedHar,
} from '../../../apps/desktop/src/main/network-export.js';
import { networkEventPayloadSchema } from '../../protocol/src/index.js';
import { HELP, parseOptions, type CliOptions } from './options.js';

const VERSION = '1.0.6';
const MAX_REQUEST_BYTES = 22 * 1024 * 1024;
const publicDirectory = fileURLToPath(new URL('./public', import.meta.url));
const mcpServerPath = fileURLToPath(new URL('./mcp-server.js', import.meta.url));

interface Download {
  name: string;
  type: string;
  base64: string;
}

interface RpcResult {
  value?: unknown;
  download?: Download;
}

type RpcHandler = (...args: never[]) => unknown;

const rpcRequestSchema = z.object({
  method: z.string().trim().min(1).max(100),
  args: z.array(z.unknown()).max(10),
});

const uploadSchema = z.object({
  name: z.string().trim().min(1).max(512),
  base64: z.string().max(30 * 1024 * 1024),
});

function json(response: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self' data:",
  });
  response.end(bytes);
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new Error('Request exceeds the 22 MiB limit.');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function cookie(request: IncomingMessage, name: string): string | undefined {
  return request.headers.cookie
    ?.split(';')
    .map((entry) => entry.trim().split('='))
    .find(([key]) => key === name)?.[1];
}

function localAddresses(port: number, secure: boolean): string[] {
  const scheme = secure ? 'wss' : 'ws';
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => `${scheme}://${entry.address}:${port}`);
}

function openBrowser(url: string): void {
  const command: string =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args: string[] = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {
    console.warn(`[PulseRN] Could not open the browser automatically. Open ${url}`);
  });
  child.unref();
}

class WebRuntime {
  readonly sessions = new SessionManager();
  readonly settings: SettingsStore;
  readonly appearance: AppearanceStore;
  readonly pairing: PairingStore;
  readonly tls: TlsCertificateStore;
  readonly database: EventDatabase;
  readonly diagnostics: DiagnosticService;
  readonly debugger: DebuggerManager;
  readonly mcp: McpBridge;
  readonly nativeLogs: NativeLogManager;
  readonly analytics: AnalyticsClient;
  private sdkServer?: DevToolWebSocketServer;
  private lastMaintenanceAt = 0;
  private readonly subscribers = new Set<WebSocket>();

  constructor(
    private readonly options: CliOptions,
    private readonly dataDirectory: string,
  ) {
    this.settings = new SettingsStore(join(dataDirectory, 'settings.json'));
    this.settings.update({
      devToolPort: options.sdkPort,
      metroPort: options.metroPort,
      launchAtLogin: false,
      keepRunningInBackground: false,
      checkForUpdatesAutomatically: false,
      ...(options.telemetry === undefined
        ? {}
        : { anonymousUsageAnalytics: options.telemetry, analyticsConsentDecided: true }),
    });
    this.analytics = new AnalyticsClient({
      statePath: join(dataDirectory, 'analytics.json'),
      version: VERSION,
      distribution: 'cli',
      enabled: () => this.settings.get().anonymousUsageAnalytics,
      apiKey: process.env['PULSERN_POSTHOG_KEY'],
      host: process.env['PULSERN_POSTHOG_HOST'],
    });
    this.appearance = new AppearanceStore(
      join(dataDirectory, 'appearance.json'),
      this.settings.get().theme,
    );
    this.pairing = new PairingStore(join(dataDirectory, 'trusted-devices.json'));
    this.tls = new TlsCertificateStore(
      join(dataDirectory, 'tls', 'certificate.pem'),
      join(dataDirectory, 'tls', 'private-key.pem'),
    );
    this.database = new EventDatabase(join(dataDirectory, 'pulse-rn.sqlite'));
    this.sessions.hydrate(this.database.recent());
    this.nativeLogs = new NativeLogManager(
      (events) => {
        this.database.insertMany(events);
        this.maintain();
        this.sessions.append(events);
        this.publish('snapshot', this.sessions.snapshot());
      },
      (statuses) => {
        this.publish('native-logs', statuses);
        if (statuses.some((status) => status.state === 'capturing')) {
          void this.analytics.capture('native_capture_started').catch(() => undefined);
        }
      },
    );
    this.diagnostics = new DiagnosticService(this.database, this.sessions);
    this.debugger = new DebuggerManager(
      join(dataDirectory, 'debugger.json'),
      () => this.settings.get().metroPort,
      (state) => this.publish('debugger', state),
      () => options.metroHost,
    );
    this.mcp = new McpBridge(
      dataDirectory,
      {
        database: () => this.database,
        debugger: () => this.debugger,
        sessions: this.sessions,
        server: () => {
          if (!this.sdkServer) throw new Error('PulseRN SDK server is not ready.');
          return this.sdkServer;
        },
        diagnostics: () => this.diagnostics,
        accessMode: () => this.settings.get().mcpAccessMode,
      },
      () => this.publish('mcp', this.mcpInfo()),
    );
  }

  async start(): Promise<void> {
    this.maintain(true);
    await this.restartSdkServer();
    if (this.settings.get().mcpEnabled) await this.mcp.start();
    void this.analytics.capture('install_started').catch(() => undefined);
    void this.analytics.capture('weekly_active').catch(() => undefined);
    if (!this.settings.get().onboardingDismissed) {
      void this.analytics.capture('onboarding_opened').catch(() => undefined);
    }
  }

  private maintain(force = false): unknown {
    const now = Date.now();
    if (!force && now - this.lastMaintenanceAt < 60_000) return undefined;
    this.lastMaintenanceAt = now;
    const settings = this.settings.get();
    return this.database.maintain(
      { maxAgeDays: settings.eventRetentionDays, maxEvents: settings.maxStoredEvents },
      now,
    );
  }

  private connectionInfo(): unknown {
    const settings = this.settings.get();
    const scheme = settings.tlsEnabled ? 'wss' : 'ws';
    return {
      mode: settings.allowLanConnections ? 'lan' : 'loopback',
      port: this.options.sdkPort,
      requiresAuth: settings.allowLanConnections,
      addresses: settings.allowLanConnections
        ? localAddresses(this.options.sdkPort, settings.tlsEnabled)
        : [`${scheme}://127.0.0.1:${this.options.sdkPort}`],
      pairing: this.pairing.pairingCode(),
      trustedDevices: this.pairing.list(),
      tls: { enabled: settings.tlsEnabled, ...this.tls.info() },
    };
  }

  private mcpInfo(): unknown {
    return {
      enabled: this.settings.get().mcpEnabled,
      available: true,
      command: process.execPath,
      args: [mcpServerPath],
      env: { PULSERN_MCP_ACCESS_FILE: this.mcp.accessFilePath },
      clients: this.mcp.clientSnapshot(),
    };
  }

  private async restartSdkServer(): Promise<void> {
    const settings = this.settings.get();
    const tls = settings.tlsEnabled ? this.tls.credentials() : undefined;
    if (settings.tlsEnabled && !tls) throw new Error('TLS is enabled but credentials are invalid.');
    await this.sdkServer?.close();
    this.sdkServer = new DevToolWebSocketServer(
      this.options.sdkPort,
      {
        onConnected: (device) => {
          this.database.recordSession(device);
          this.sessions.connect(device);
          this.nativeLogs.start(device);
          this.publish('snapshot', this.sessions.snapshot());
          this.publish('connection', this.connectionInfo());
          void this.analytics
            .capture('first_app_connected', { sdkVersion: device.device.sdkVersion })
            .catch(() => undefined);
        },
        onDisconnected: (connectionId, info) => {
          this.nativeLogs.stop(connectionId);
          const device = this.sessions.disconnect(connectionId);
          if (device) this.database.endSession(device.sessionId, info);
          this.publish('snapshot', this.sessions.snapshot());
        },
        onEvents: (events) => {
          this.database.insertMany(events);
          this.maintain();
          this.sessions.append(events);
          this.publish('snapshot', this.sessions.snapshot());
          if (events.length > 0) {
            void this.analytics.capture('first_event_persisted').catch(() => undefined);
          }
        },
        onHealth: (connectionId, health) => {
          this.sessions.updateHealth(connectionId, health);
          this.publish('devices', this.sessions.snapshot().devices);
        },
        onInvalidMessage: (error) => console.warn('[PulseRN] Rejected SDK message:', error),
      },
      settings.allowLanConnections ? '0.0.0.0' : '127.0.0.1',
      settings.allowLanConnections
        ? (hello) =>
            this.pairing.authenticate({
              appId: hello.appId,
              deviceId: hello.deviceId,
              appName: hello.device.appName,
              deviceName: hello.device.name,
              pairingCode: hello.pairingCode,
              reconnectToken: hello.reconnectToken,
            })
        : undefined,
      tls,
    );
    await this.sdkServer.start();
    this.publish('connection', this.connectionInfo());
  }

  addSubscriber(socket: WebSocket): void {
    this.subscribers.add(socket);
    socket.on('close', () => this.subscribers.delete(socket));
  }

  private publish(type: string, value: unknown): void {
    const frame = JSON.stringify({ type, value });
    for (const socket of this.subscribers) {
      if (socket.readyState === socket.OPEN) socket.send(frame);
    }
  }

  private download(name: string, type: string, bytes: Buffer | string): RpcResult {
    return {
      value: { canceled: false },
      download: {
        name,
        type,
        base64: Buffer.from(bytes).toString('base64'),
      },
    };
  }

  handlers(): Record<string, RpcHandler> {
    const database = this.database;
    const debuggerManager = this.debugger;
    return {
      getSnapshot: () => this.sessions.snapshot(),
      getNativeLogStatuses: () => this.nativeLogs.snapshot(),
      queryEvents: (input: never) => database.query(input),
      getEvent: (id: never) => database.findById(id),
      listSavedFilters: () => database.listSavedFilters(),
      saveEventFilter: (name: never, query: never, id: never) =>
        database.saveFilter(name, query, id),
      deleteSavedFilter: (id: never) => database.deleteSavedFilter(id),
      listBookmarks: (sessionId: never) => database.listBookmarks(sessionId),
      addBookmark: (eventId: never, label: never) => database.addBookmark(eventId, label),
      deleteBookmark: (id: never) => database.deleteBookmark(id),
      listAnnotations: (eventId: never, sessionId: never) =>
        database.listAnnotations(eventId, sessionId),
      saveAnnotation: (eventId: never, body: never, id: never) =>
        database.saveAnnotation(eventId, body, id),
      deleteAnnotation: (id: never) => database.deleteAnnotation(id),
      getNetworkCurl: (eventId: never) => {
        const event = database.findById(eventId);
        const parsed = event ? networkEventPayloadSchema.safeParse(event.payload) : undefined;
        if (!parsed?.success) throw new Error('The selected completed request does not exist.');
        return createCurlCommand(parsed.data);
      },
      exportNetworkHar: (sessionId: never) => {
        const events = [];
        let cursor;
        do {
          const page = database.query({
            category: 'network',
            type: 'network.request',
            sessionId,
            order: 'oldest',
            limit: 500,
            cursor,
          });
          events.push(...page.events);
          cursor = page.nextCursor;
        } while (cursor);
        const har = createSanitizedHar(events);
        const result = this.download(
          'PulseRN-network.har',
          'application/json',
          `${JSON.stringify(har, null, 2)}\n`,
        );
        result.value = { canceled: false, entries: har.log.entries.length };
        return result;
      },
      listSessions: () => database.listSessions(),
      createDemoSession: () => {
        const demo = createDemoSession();
        database.recordSession(demo.device);
        database.insertMany(demo.events);
        database.endSession(demo.device.sessionId, {
          code: 1000,
          reason: 'Offline demo session',
          disconnectedAt: Date.now(),
        });
        this.sessions.hydrate(database.recent());
        this.publish('snapshot', this.sessions.snapshot());
        void this.analytics.capture('demo_opened').catch(() => undefined);
        return database.listSessions().find((entry) => entry.sessionId === demo.device.sessionId)!;
      },
      renameSession: (sessionId: never, displayName: never) =>
        database.renameSession(sessionId, displayName),
      deleteSession: (sessionId: never) => {
        const result = database.deleteSession(sessionId);
        this.sessions.hydrate(database.recent());
        this.publish('snapshot', this.sessions.snapshot());
        return result;
      },
      listStoredDevices: () => database.listDevices(),
      getRetentionState: () => database.retentionState(),
      exportSessions: (sessionIds: never) => {
        const archive = createSessionArchive(database, sessionIds);
        const result = this.download(
          'PulseRN-sessions.pulsern',
          'application/octet-stream',
          encodeSessionArchive(archive),
        );
        result.value = {
          canceled: false,
          sessions: archive.sessions.length,
          events: archive.events.length,
        };
        return result;
      },
      importSessionsData: (value: never) => {
        const upload = uploadSchema.parse(value);
        const bytes = Buffer.from(upload.base64, 'base64');
        if (bytes.byteLength > 100 * 1024 * 1024) throw new Error('Archive exceeds 100 MiB.');
        const imported = importSessionArchive(database, decodeSessionArchive(bytes));
        this.maintain(true);
        this.sessions.hydrate(database.recent());
        this.publish('snapshot', this.sessions.snapshot());
        return { canceled: false, ...imported };
      },
      runDatabaseMaintenance: () => this.maintain(true),
      clearStoredEvents: () => {
        const result = database.clear();
        this.sessions.hydrate([]);
        this.publish('snapshot', this.sessions.snapshot());
        return result;
      },
      requestStorage: async (input: never) => {
        if (!this.sdkServer) throw new Error('PulseRN SDK server is not ready.');
        const request = z
          .object({
            connectionId: z.string().min(1).max(256),
            providerId: z.string().min(1).max(256),
            operation: z.enum(['list', 'get', 'set', 'delete', 'restore']),
            key: z.string().max(10_000).optional(),
            value: z.string().max(1_000_000).optional(),
            cursor: z.string().max(100).optional(),
            limit: z.number().int().min(1).max(500).optional(),
            backupId: z.string().max(256).optional(),
          })
          .parse(input);
        const result = await this.sdkServer.requestStorage(request.connectionId, request);
        if (['set', 'delete', 'restore'].includes(request.operation)) {
          database.recordStorageAudit({
            connectionId: request.connectionId,
            providerId: request.providerId,
            key: request.key ?? '',
            operation: request.operation as 'set' | 'delete' | 'restore',
            success: result.success,
            ...(result.backupId ? { backupId: result.backupId } : {}),
            ...(result.error ? { error: result.error } : {}),
          });
        }
        return result;
      },
      listStorageAudit: () => database.listStorageAudit(),
      createStorageSnapshot: async (input: never) => {
        if (!this.sdkServer) throw new Error('PulseRN SDK server is not ready.');
        const parsed = z
          .object({ connectionId: z.string(), providerId: z.string(), key: z.string() })
          .parse(input);
        const result = await this.sdkServer.requestStorage(parsed.connectionId, {
          providerId: parsed.providerId,
          operation: 'get',
          key: parsed.key,
        });
        if (!result.success || result.value == null || result.sensitive || result.redacted) {
          throw new Error('Sensitive, redacted, or missing values cannot be snapshotted.');
        }
        return database.saveStorageSnapshot({
          ...parsed,
          value: result.value,
          valueType: result.valueType ?? 'unknown',
          valueSize: result.valueSize ?? Buffer.byteLength(result.value),
        });
      },
      listStorageSnapshots: (providerId: never, key: never) =>
        database.listStorageSnapshots(providerId, key),
      deleteStorageSnapshot: (id: never) => database.deleteStorageSnapshot(id),
      exportStorageValues: async (itemsValue: never) => {
        if (!this.sdkServer) throw new Error('PulseRN SDK server is not ready.');
        const items = z
          .array(z.object({ connectionId: z.string(), providerId: z.string(), key: z.string() }))
          .max(100)
          .parse(itemsValue);
        const values = [];
        let excluded = 0;
        for (const item of items) {
          const result = await this.sdkServer.requestStorage(item.connectionId, {
            providerId: item.providerId,
            operation: 'get',
            key: item.key,
          });
          if (!result.success || result.value == null || result.sensitive || result.redacted) {
            excluded += 1;
          } else {
            values.push({
              providerId: item.providerId,
              key: item.key,
              value: result.value,
              valueType: result.valueType,
              valueSize: result.valueSize,
            });
          }
        }
        const result = this.download(
          `PulseRN-storage-${new Date().toISOString().slice(0, 10)}.json`,
          'application/json',
          `${JSON.stringify({ format: 'pulsern-storage-export', version: 1, values }, null, 2)}\n`,
        );
        result.value = { canceled: false, exported: values.length, excluded };
        return result;
      },
      getSettings: () => this.settings.get(),
      updateSettings: async (patch: never) => {
        const previous = this.settings.get();
        const next = this.settings.update(patch);
        if (!next.anonymousUsageAnalytics && previous.anonymousUsageAnalytics) {
          await this.analytics.reset();
        }
        if (next.mcpEnabled !== previous.mcpEnabled) {
          try {
            if (next.mcpEnabled) await this.mcp.start();
            else await this.mcp.stop();
          } catch (error) {
            this.settings.update({ mcpEnabled: previous.mcpEnabled });
            throw error;
          }
        }
        const serverChanged =
          next.allowLanConnections !== previous.allowLanConnections ||
          next.tlsEnabled !== previous.tlsEnabled ||
          next.devToolPort !== previous.devToolPort;
        if (next.devToolPort !== this.options.sdkPort) {
          this.settings.update({ devToolPort: this.options.sdkPort });
          throw new Error(
            `The CLI SDK port is fixed at ${this.options.sdkPort}; restart with --sdk-port to change it.`,
          );
        }
        if (serverChanged) await this.restartSdkServer();
        this.publish('settings', this.settings.get());
        return this.settings.get();
      },
      getAppearance: () => this.appearance.get(),
      updateAppearanceSelection: (patch: never) => {
        const state = this.appearance.updateSelection(patch);
        this.publish('appearance', state);
        return state;
      },
      saveTheme: (theme: never) => {
        const state = this.appearance.saveTheme(theme);
        this.publish('appearance', state);
        return state;
      },
      duplicateTheme: (id: never) => {
        const state = this.appearance.duplicateTheme(id);
        this.publish('appearance', state);
        return state;
      },
      deleteTheme: (id: never) => {
        const state = this.appearance.deleteTheme(id);
        this.publish('appearance', state);
        return state;
      },
      importThemeData: (value: never) => {
        const upload = uploadSchema.parse(value);
        const payload = z
          .object({ format: z.literal('pulsern-theme'), version: z.literal(1), theme: z.unknown() })
          .parse(JSON.parse(Buffer.from(upload.base64, 'base64').toString('utf8')));
        const theme = themeDefinitionSchema.omit({ builtin: true }).parse(payload.theme);
        const state = this.appearance.saveTheme({ ...theme, id: `theme-${randomUUID()}` });
        this.publish('appearance', state);
        return state;
      },
      exportTheme: (id: never) => {
        const theme = this.appearance.get().themes.find((entry) => entry.id === id);
        if (!theme) throw new Error('Theme not found.');
        const result = this.download(
          `${theme.name.replace(/[^a-z0-9]+/gi, '-')}.pulsern-theme.json`,
          'application/json',
          `${JSON.stringify({ format: 'pulsern-theme', version: 1, theme: { ...theme, builtin: false } }, null, 2)}\n`,
        );
        result.value = { canceled: false };
        return result;
      },
      importFontData: async (value: never) => {
        const upload = uploadSchema.parse(value);
        const bytes = Buffer.from(upload.base64, 'base64');
        if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('Font exceeds 20 MiB.');
        const extension = extname(upload.name).slice(1).toLowerCase();
        const formats = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' } as const;
        const format = formats[extension as keyof typeof formats];
        if (!format) throw new Error('Unsupported font format.');
        const hash = createHash('sha256').update(bytes).digest('hex');
        const fileName = `${hash}.${extension}`;
        await mkdir(join(this.dataDirectory, 'fonts'), { recursive: true, mode: 0o700 });
        await writeFile(join(this.dataDirectory, 'fonts', fileName), bytes, { mode: 0o600 });
        const state = this.appearance.addFont({
          id: `font-${hash.slice(0, 20)}`,
          family: basename(upload.name, extname(upload.name)),
          style: 'normal',
          weight: 400,
          source: 'imported',
          fileName,
          format,
        });
        this.publish('appearance', state);
        return state;
      },
      registerSystemFont: (fontValue: never) => {
        const font = z
          .object({ family: z.string(), style: z.string(), weight: z.number().int() })
          .parse(fontValue);
        const id = createHash('sha256')
          .update(`${font.family}:${font.style}:${font.weight}`)
          .digest('hex')
          .slice(0, 16);
        const state = this.appearance.addFont({ ...font, id: `system-${id}`, source: 'system' });
        this.publish('appearance', state);
        return state;
      },
      deleteFont: async (id: never) => {
        const font = this.appearance.get().fonts.find((entry) => entry.id === id);
        const state = this.appearance.removeFont(id);
        if (font?.fileName)
          await unlink(join(this.dataDirectory, 'fonts', font.fileName)).catch(() => undefined);
        this.publish('appearance', state);
        return state;
      },
      loadFont: async (id: never) => {
        const font = this.appearance.get().fonts.find((entry) => entry.id === id);
        if (!font?.fileName) throw new Error('Imported font not found.');
        return [...(await readFile(join(this.dataDirectory, 'fonts', font.fileName)))];
      },
      getMcpInfo: () => this.mcpInfo(),
      getConnectionInfo: () => this.connectionInfo(),
      beginPairing: () => {
        const settings = this.settings.get();
        this.pairing.begin(
          Date.now(),
          settings.pairingCodeLifetimeMinutes,
          settings.pairingRetryLimit,
        );
        const info = this.connectionInfo();
        this.publish('connection', info);
        return info;
      },
      revokeTrustedDevice: (appId: never, deviceId: never) => {
        this.pairing.revoke(appId, deviceId);
        this.sdkServer?.disconnectDevice(appId, deviceId);
        return this.connectionInfo();
      },
      installTlsCertificateData: async (certificateValue: never, keyValue: never) => {
        const certificate = uploadSchema.parse(certificateValue);
        const key = uploadSchema.parse(keyValue);
        this.tls.install(
          Buffer.from(certificate.base64, 'base64'),
          Buffer.from(key.base64, 'base64'),
        );
        this.settings.update({ tlsEnabled: true });
        await this.restartSdkServer();
        return this.connectionInfo();
      },
      disableTls: async () => {
        this.settings.update({ tlsEnabled: false });
        await this.restartSdkServer();
        this.tls.remove();
        return this.connectionInfo();
      },
      getUpdateState: () => ({
        enabled: false,
        status: 'disabled',
        currentVersion: VERSION,
        message: 'Updates are managed by npm. Run npx @maahibhama/pulsern@latest.',
      }),
      getDebuggerState: () => debuggerManager.snapshot(),
      discoverDebuggerTargets: () => debuggerManager.discover(),
      connectDebugger: (targetId: never) => debuggerManager.connect(targetId),
      disconnectDebugger: () => debuggerManager.disconnect(),
      getDebuggerSource: (sourceId: never) => debuggerManager.getSource(sourceId),
      searchDebuggerSources: (query: never, limit: never) =>
        debuggerManager.searchSources(query, limit),
      getDebuggerSourceContext: (sourceId: never, line: never, contextLines: never) =>
        debuggerManager.getSourceContext(sourceId, line, contextLines),
      addDebuggerBreakpoint: (input: never) => debuggerManager.addBreakpoint(input),
      removeDebuggerBreakpoint: (id: never) => debuggerManager.removeBreakpoint(id),
      removeTemporaryDebuggerBreakpoints: () => debuggerManager.removeTemporaryBreakpoints(),
      setDebuggerBreakpointEnabled: (id: never, enabled: never) =>
        debuggerManager.setBreakpointEnabled(id, enabled),
      debuggerCommand: (command: never) => debuggerManager.command(command),
      selectDebuggerCallFrame: (id: never) => debuggerManager.selectCallFrame(id),
      getDebuggerScope: (objectId: never) => debuggerManager.getScope(objectId),
      getDebuggerProperties: (objectId: never) => debuggerManager.getProperties(objectId),
      addDebuggerWatch: (expression: never) => debuggerManager.addWatch(expression),
      removeDebuggerWatch: (id: never) => debuggerManager.removeWatch(id),
      evaluateDebuggerExpression: (expression: never, options: never) =>
        debuggerManager.evaluate(expression, options),
      releaseDebuggerObject: (objectId: never) => debuggerManager.releaseObject(objectId),
      getReactComponentSnapshot: () => debuggerManager.getReactComponentSnapshot(),
      interactWithReactComponent: (action: never, componentId: never) =>
        debuggerManager.interactWithReactComponent(action, componentId),
      setPauseOnExceptions: (mode: never) => debuggerManager.setPauseOnExceptions(mode),
      setDebuggerBlackboxInternal: (enabled: never) => debuggerManager.setBlackboxInternal(enabled),
    };
  }

  async close(): Promise<void> {
    for (const socket of this.subscribers) socket.close(1001, 'Server shutting down');
    this.debugger.close();
    this.nativeLogs.close();
    await this.mcp.stop();
    await this.sdkServer?.close();
    this.database.close();
  }
}

async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requested = new URL(request.url ?? '/', 'http://localhost').pathname;
  const relative = requested === '/' ? 'index.html' : requested.slice(1);
  const path = normalize(join(publicDirectory, relative));
  if (!path.startsWith(publicDirectory) || !existsSync(path)) {
    const fallback = join(publicDirectory, 'index.html');
    const bytes = await readFile(fallback);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(bytes);
    return;
  }
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  };
  const bytes = await readFile(path);
  response.writeHead(200, {
    'content-type': types[extname(path)] ?? 'application/octet-stream',
    'cache-control': relative === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  });
  response.end(bytes);
}

async function main(): Promise<void> {
  const parsed = parseOptions(process.argv.slice(2));
  if (parsed === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (parsed === 'version') {
    console.log(VERSION);
    return;
  }
  await mkdir(parsed.dataDir, { recursive: true, mode: 0o700 });
  if (parsed.resetBrowserToken) {
    await unlink(join(parsed.dataDir, 'browser-session')).catch(() => undefined);
  }
  const bootstrapToken = randomBytes(32).toString('base64url');
  const browserSession = randomBytes(32).toString('base64url');
  await writeFile(join(parsed.dataDir, 'browser-session'), browserSession, { mode: 0o600 });
  const runtime = new WebRuntime(parsed, parsed.dataDir);
  await runtime.start();
  const handlers = runtime.handlers();
  const liveServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      const expectedHost = parsed.host === '0.0.0.0' ? undefined : parsed.host;
      if (expectedHost && !['localhost', '127.0.0.1', expectedHost].includes(url.hostname)) {
        return json(response, 400, { ok: false, error: 'Unexpected Host header.' });
      }
      if (url.pathname === '/setup' && url.searchParams.get('token') === bootstrapToken) {
        response.writeHead(302, {
          location: '/',
          'set-cookie': `pulsern_session=${browserSession}; HttpOnly; SameSite=Strict; Path=/`,
          'cache-control': 'no-store',
        });
        response.end();
        return;
      }
      const authenticated = cookie(request, 'pulsern_session') === browserSession;
      if (url.pathname === '/api/v1/health') {
        return json(response, 200, { ok: true, version: VERSION });
      }
      if (url.pathname === '/api/v1/call') {
        if (!authenticated)
          return json(response, 401, { ok: false, error: 'Authentication required.' });
        if (request.method !== 'POST')
          return json(response, 405, { ok: false, error: 'POST required.' });
        const input = rpcRequestSchema.parse(await requestBody(request));
        const handler = handlers[input.method];
        if (!handler) return json(response, 404, { ok: false, error: 'Unknown API method.' });
        const output = await handler(...(input.args as never[]));
        const result =
          output && typeof output === 'object' && ('download' in output || 'value' in output)
            ? (output as RpcResult)
            : { value: output };
        return json(response, 200, { ok: true, ...result });
      }
      if (!authenticated) {
        response.writeHead(302, {
          location: `/setup?token=${bootstrapToken}`,
          'cache-control': 'no-store',
        });
        response.end();
        return;
      }
      await serveStatic(request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PulseRN request failed.';
      console.warn('[PulseRN] Request rejected:', message);
      if (!response.headersSent) json(response, 400, { ok: false, error: message });
      else response.destroy();
    }
  });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (
      url.pathname !== '/live' ||
      cookie(request, 'pulsern_session') !== browserSession ||
      (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host)
    ) {
      socket.destroy();
      return;
    }
    liveServer.handleUpgrade(request, socket, head, (webSocket) => {
      runtime.addSubscriber(webSocket);
      liveServer.emit('connection', webSocket, request);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(parsed.port, parsed.host, resolve);
  });

  const browserHost = parsed.host === '0.0.0.0' ? '127.0.0.1' : parsed.host;
  const browserUrl = `http://${browserHost}:${parsed.port}/setup?token=${bootstrapToken}`;
  const lan = localAddresses(parsed.sdkPort, false)[0];
  console.log('');
  console.log(`PulseRN web:       http://${browserHost}:${parsed.port}`);
  console.log(`SDK loopback:      ws://127.0.0.1:${parsed.sdkPort}`);
  console.log(`Android emulator: ws://10.0.2.2:${parsed.sdkPort}`);
  console.log(`Physical device:  ${lan ?? 'No LAN IPv4 address detected'}`);
  console.log(`Metro:            http://${parsed.metroHost}:${parsed.metroPort}`);
  console.log(`Data directory:   ${parsed.dataDir}`);
  console.log('');
  console.log('Press Ctrl+C to stop PulseRN.');
  if (parsed.open) openBrowser(browserUrl);
  else console.log(`Open ${browserUrl}`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\n[PulseRN] Shutting down…');
    await runtime.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  process.once('SIGINT', () => void stop().then(() => process.exit(0)));
  process.once('SIGTERM', () => void stop().then(() => process.exit(0)));
}

main().catch((error) => {
  console.error(`[PulseRN] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
