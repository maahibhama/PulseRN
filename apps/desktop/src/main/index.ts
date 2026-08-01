import { isAbsolute, join } from 'node:path';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import electronUpdater from 'electron-updater';
import { eventCategorySchema, storageOperationSchema } from '@pulse-rn/protocol';
import { z } from 'zod';
import { EventDatabase } from './database.js';
import { SessionManager } from './session-manager.js';
import { SettingsStore } from './settings.js';
import { DevToolWebSocketServer } from './websocket-server.js';
import { DebuggerManager } from './debugger-manager.js';
import {
  createSessionArchive,
  decodeSessionArchive,
  encodeSessionArchive,
  importSessionArchive,
} from './session-archive.js';
import { PairingStore } from './pairing-store.js';
import { TlsCertificateStore } from './tls-certificate.js';
import { UpdateManager, type DesktopUpdaterAdapter } from './update-manager.js';
import { createCurlCommand, createSanitizedHar } from './network-export.js';
import { McpBridge } from './mcp-bridge.js';
import { networkEventPayloadSchema } from '@pulse-rn/protocol';

const SNAPSHOT_CHANNEL = 'pulse-rn:snapshot';
const DEVICES_CHANNEL = 'pulse-rn:devices';
const EVENTS_CHANNEL = 'pulse-rn:events';
const STORAGE_CHANNEL = 'pulse-rn:storage';
const STORAGE_LOCAL_CHANNEL = 'pulse-rn:storage-local';
const SETTINGS_CHANNEL = 'pulse-rn:settings';
const DEBUGGER_CHANNEL = 'pulse-rn:debugger';
const CONNECTION_CHANNEL = 'pulse-rn:connection';
const UPDATE_CHANNEL = 'pulse-rn:update';
const MCP_CHANNEL = 'pulse-rn:mcp';
const DARK_APP_ICON = join(__dirname, '../../resources/pulse-rn-app-icon-dark.png');
const LIGHT_APP_ICON = join(__dirname, '../../resources/pulse-rn-app-icon-light.png');
const e2eUserDataDirectory = process.env['PULSE_RN_E2E_USER_DATA_DIR'];
if (!app.isPackaged && e2eUserDataDirectory && isAbsolute(e2eUserDataDirectory)) {
  app.setPath('userData', e2eUserDataDirectory);
}
const configuredServerPort = Number(process.env['PULSE_RN_E2E_SERVER_PORT']);
const storageRequestSchema = z.object({
  connectionId: z.string().trim().min(1).max(256),
  providerId: z.string().trim().min(1).max(256),
  operation: storageOperationSchema,
  key: z.string().max(10_000).optional(),
  value: z.string().max(1_000_000).optional(),
  cursor: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  backupId: z.string().trim().min(1).max(256).optional(),
});
const storageIdentitySchema = z.object({
  connectionId: z.string().trim().min(1).max(256),
  providerId: z.string().trim().min(1).max(256),
  key: z.string().max(10_000),
});
const storageLocalRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('audit') }),
  storageIdentitySchema.extend({ operation: z.literal('snapshot-create') }),
  z.object({
    operation: z.literal('snapshot-list'),
    providerId: z.string().trim().min(1).max(256).optional(),
    key: z.string().max(10_000).optional(),
  }),
  z.object({
    operation: z.literal('snapshot-delete'),
    id: z.string().trim().min(1).max(256),
  }),
  z.object({
    operation: z.literal('export'),
    items: z.array(storageIdentitySchema).min(1).max(100),
  }),
]);
const eventCursorSchema = z.object({
  timestamp: z.number().finite().nonnegative(),
  sequence: z.number().int().nonnegative(),
  id: z.string().trim().min(1).max(256),
});
const eventQuerySchema = z
  .object({
    category: eventCategorySchema.optional(),
    categories: z.array(eventCategorySchema).min(1).max(8).optional(),
    cursor: eventCursorSchema.optional(),
    direction: z.enum(['forward', 'backward']).optional(),
    deviceId: z.string().trim().min(1).max(256).optional(),
    endTime: z.number().finite().nonnegative().optional(),
    errorsOnly: z.boolean().optional(),
    correlationId: z.string().trim().min(1).max(256).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    order: z.enum(['newest', 'oldest']).optional(),
    parentId: z.string().trim().min(1).max(256).optional(),
    sessionId: z.string().trim().min(1).max(256).optional(),
    startTime: z.number().finite().nonnegative().optional(),
    text: z.string().trim().min(1).max(1_000).optional(),
    type: z.string().trim().min(1).max(256).optional(),
    types: z.array(z.string().trim().min(1).max(256)).min(1).max(100).optional(),
  })
  .strict();
const savedEventQuerySchema = eventQuerySchema.omit({
  cursor: true,
  direction: true,
  limit: true,
});
const eventRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('query'), input: eventQuerySchema }),
  z.object({ operation: z.literal('find'), id: z.string().trim().min(1).max(256) }),
  z.object({ operation: z.literal('listSavedFilters') }),
  z.object({
    operation: z.literal('saveEventFilter'),
    id: z.string().trim().min(1).max(256).optional(),
    name: z.string().trim().min(1).max(128),
    query: savedEventQuerySchema,
  }),
  z.object({
    operation: z.literal('deleteSavedFilter'),
    id: z.string().trim().min(1).max(256),
  }),
  z.object({
    operation: z.literal('listBookmarks'),
    sessionId: z.string().trim().min(1).max(256).optional(),
  }),
  z.object({
    operation: z.literal('addBookmark'),
    eventId: z.string().trim().min(1).max(256),
    label: z.string().trim().max(256).optional(),
  }),
  z.object({
    operation: z.literal('deleteBookmark'),
    id: z.string().trim().min(1).max(256),
  }),
  z.object({
    operation: z.literal('listAnnotations'),
    eventId: z.string().trim().min(1).max(256).optional(),
    sessionId: z.string().trim().min(1).max(256).optional(),
  }),
  z.object({
    operation: z.literal('saveAnnotation'),
    id: z.string().trim().min(1).max(256).optional(),
    eventId: z.string().trim().min(1).max(256),
    body: z.string().trim().min(1).max(10_000),
  }),
  z.object({
    operation: z.literal('deleteAnnotation'),
    id: z.string().trim().min(1).max(256),
  }),
  z.object({
    operation: z.literal('networkCurl'),
    eventId: z.string().trim().min(1).max(256),
  }),
  z.object({
    operation: z.literal('exportNetworkHar'),
    sessionId: z.string().trim().min(1).max(256).optional(),
  }),
  z.object({ operation: z.literal('sessions') }),
  z.object({
    operation: z.literal('renameSession'),
    sessionId: z.string().trim().min(1).max(256),
    displayName: z.string().trim().min(1).max(256),
  }),
  z.object({
    operation: z.literal('deleteSession'),
    sessionId: z.string().trim().min(1).max(256),
  }),
  z.object({ operation: z.literal('devices') }),
  z.object({ operation: z.literal('retentionState') }),
  z.object({ operation: z.literal('maintain') }),
  z.object({ operation: z.literal('clear') }),
  z.object({
    operation: z.literal('export'),
    sessionIds: z.array(z.string().trim().min(1).max(256)).min(1).max(500).optional(),
  }),
  z.object({ operation: z.literal('import') }),
]);
const sessions = new SessionManager();
let database: EventDatabase | undefined;
let server: DevToolWebSocketServer | undefined;
let window: BrowserWindow | undefined;
let settingsStore: SettingsStore | undefined;
let debuggerManager: DebuggerManager | undefined;
let pairingStore: PairingStore | undefined;
let tlsCertificateStore: TlsCertificateStore | undefined;
let updateManager: UpdateManager | undefined;
let mcpBridge: McpBridge | undefined;
let automaticUpdateTimer: ReturnType<typeof setTimeout> | undefined;
let isQuitting = false;
let shutdownComplete = false;
let shutdownPromise: Promise<void> | undefined;
let lastDatabaseMaintenanceAt = 0;

function retentionPolicy() {
  const settings = settingsStore?.get();
  return {
    maxAgeDays: settings?.eventRetentionDays ?? 30,
    maxEvents: settings?.maxStoredEvents ?? 100_000,
  };
}

function maintainDatabase(force = false) {
  if (!database) throw new Error('PulseRN database is not ready.');
  const now = Date.now();
  if (!force && now - lastDatabaseMaintenanceAt < 60_000) return undefined;
  lastDatabaseMaintenanceAt = now;
  return database.maintain(retentionPolicy(), now);
}

function effectiveServerPort(settings: { devToolPort: number }): number {
  return !app.isPackaged &&
    Number.isInteger(configuredServerPort) &&
    configuredServerPort >= 1_024 &&
    configuredServerPort <= 65_535
    ? configuredServerPort
    : settings.devToolPort;
}

function mcpInfo() {
  const serverPath = app.isPackaged
    ? join(process.resourcesPath, 'mcp', 'server.js')
    : join(app.getAppPath(), '../../packages/mcp/dist/server.js');
  return {
    enabled: settingsStore?.get().mcpEnabled ?? false,
    available: Boolean(mcpBridge),
    command: process.execPath,
    args: [serverPath],
    env: { ELECTRON_RUN_AS_NODE: '1' as const },
    clients: mcpBridge?.clientSnapshot() ?? [],
  };
}

function publishMcpInfo(): void {
  if (window && !window.isDestroyed()) window.webContents.send(MCP_CHANNEL, mcpInfo());
}

async function readTlsCredentialFile(path: string): Promise<Buffer> {
  const file = await stat(path);
  if (!file.isFile() || file.size > 1024 * 1024) {
    throw new Error('TLS certificate and key selections must be files no larger than 1 MiB.');
  }
  return readFile(path);
}

async function isAutoUpdateBuild(): Promise<boolean> {
  if (!app.isPackaged) return false;
  try {
    const metadata: unknown = JSON.parse(
      await readFile(join(app.getAppPath(), 'package.json'), 'utf8'),
    );
    return z
      .object({ pulseRNAutoUpdate: z.literal(true) })
      .passthrough()
      .safeParse(metadata).success;
  } catch {
    return false;
  }
}

function connectionInfo() {
  if (!settingsStore || !pairingStore || !tlsCertificateStore) {
    throw new Error('PulseRN connection settings are not ready.');
  }
  const settings = settingsStore.get();
  const port = effectiveServerPort(settings);
  const scheme = settings.tlsEnabled ? 'wss' : 'ws';
  const addresses = settings.allowLanConnections
    ? Object.values(networkInterfaces())
        .flatMap((entries) => entries ?? [])
        .filter((entry) => entry.family === 'IPv4' && !entry.internal)
        .map((entry) => `${scheme}://${entry.address}:${port}`)
    : [`${scheme}://127.0.0.1:${port}`];
  return {
    mode: settings.allowLanConnections ? ('lan' as const) : ('loopback' as const),
    port,
    requiresAuth: settings.allowLanConnections,
    addresses: [...new Set(addresses)],
    pairing: pairingStore.pairingCode(),
    trustedDevices: pairingStore.list(),
    tls: {
      enabled: settings.tlsEnabled,
      ...tlsCertificateStore.info(),
    },
  };
}

async function restartServer(settings = settingsStore?.get()): Promise<void> {
  if (!settings || !pairingStore || !tlsCertificateStore) {
    throw new Error('PulseRN server settings are not ready.');
  }
  const tlsCredentials = settings.tlsEnabled ? tlsCertificateStore.credentials() : undefined;
  if (settings.tlsEnabled && !tlsCredentials) {
    throw new Error('TLS is enabled but no valid certificate and private key are configured.');
  }
  await server?.close();
  server = new DevToolWebSocketServer(
    effectiveServerPort(settings),
    {
      onConnected(device) {
        database?.recordSession(device);
        sessions.connect(device);
        publish();
      },
      onDisconnected(connectionId, info) {
        const disconnected = sessions.disconnect(connectionId);
        if (disconnected) database?.endSession(disconnected.sessionId, info);
        publish();
      },
      onEvents(events) {
        database?.insertMany(events);
        maintainDatabase();
        sessions.append(events);
        publish();
      },
      onHealth(connectionId, health) {
        sessions.updateHealth(connectionId, health);
        if (window && !window.isDestroyed()) {
          window.webContents.send(DEVICES_CHANNEL, sessions.snapshot().devices);
        }
      },
      onInvalidMessage(error) {
        console.warn('[PulseRN] Rejected invalid client message:', error);
      },
    },
    settings.allowLanConnections ? '0.0.0.0' : '127.0.0.1',
    settings.allowLanConnections
      ? (hello) => {
          const legacyCredential = hello.authToken;
          const result = pairingStore!.authenticate({
            appId: hello.appId,
            deviceId: hello.deviceId,
            appName: hello.device.appName,
            deviceName: hello.device.name,
            pairingCode:
              hello.pairingCode ?? (legacyCredential?.includes('-') ? legacyCredential : undefined),
            reconnectToken:
              hello.reconnectToken ??
              (legacyCredential && !legacyCredential.includes('-') ? legacyCredential : undefined),
          });
          if (window && !window.isDestroyed()) {
            window.webContents.send(CONNECTION_CHANNEL, connectionInfo());
          }
          return result;
        }
      : undefined,
    tlsCredentials,
  );
  await server.start();
  if (window && !window.isDestroyed()) {
    window.webContents.send(CONNECTION_CHANNEL, connectionInfo());
  }
}

function appIconPath(theme: 'system' | 'dark' | 'light'): string {
  const resolvedTheme =
    theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme;
  return resolvedTheme === 'dark' ? DARK_APP_ICON : LIGHT_APP_ICON;
}

function applyAppIcon(theme: 'system' | 'dark' | 'light'): void {
  const icon = appIconPath(theme);
  if (process.platform === 'darwin') app.dock?.setIcon(icon);
  if (window && !window.isDestroyed()) window.setIcon(icon);
}

function handleNativeThemeUpdated(): void {
  if (settingsStore?.get().theme === 'system') applyAppIcon('system');
}

function publish(): void {
  if (window && !window.isDestroyed())
    window.webContents.send(SNAPSHOT_CHANNEL, sessions.snapshot());
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'PulseRN',
    icon: appIconPath(settingsStore?.get().theme ?? 'system'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.on('close', (event) => {
    if (
      process.platform === 'darwin' &&
      !isQuitting &&
      settingsStore?.get().keepRunningInBackground
    ) {
      event.preventDefault();
      window?.hide();
    }
  });
  window.once('ready-to-show', () => window?.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  settingsStore = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  pairingStore = new PairingStore(join(app.getPath('userData'), 'trusted-devices.json'));
  tlsCertificateStore = new TlsCertificateStore(
    join(app.getPath('userData'), 'tls', 'certificate.pem'),
    join(app.getPath('userData'), 'tls', 'private-key.pem'),
  );
  const autoUpdateBuild = await isAutoUpdateBuild();
  updateManager = new UpdateManager(
    electronUpdater.autoUpdater as unknown as DesktopUpdaterAdapter,
    {
      enabled: autoUpdateBuild,
      currentVersion: app.getVersion(),
      channel: settingsStore.get().updateChannel,
      disabledReason: app.isPackaged
        ? 'This unsigned preview cannot install updates automatically. Download the latest release from GitHub.'
        : 'Automatic updates are available only in signed packaged builds.',
      onState(state) {
        if (window && !window.isDestroyed()) window.webContents.send(UPDATE_CHANNEL, state);
      },
    },
  );
  debuggerManager = new DebuggerManager(
    join(app.getPath('userData'), 'debugger.json'),
    () => settingsStore?.get().metroPort ?? 8081,
    (state) => {
      if (window && !window.isDestroyed()) window.webContents.send(DEBUGGER_CHANNEL, state);
    },
  );
  let initialSettings = settingsStore.get();
  if (initialSettings.tlsEnabled && !tlsCertificateStore.credentials()) {
    console.warn('[PulseRN] TLS configuration is invalid; falling back to loopback mode.');
    initialSettings = settingsStore.update({
      tlsEnabled: false,
      allowLanConnections: false,
    });
  }
  nativeTheme.themeSource = initialSettings.theme;
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: initialSettings.launchAtLogin });
  applyAppIcon(initialSettings.theme);
  nativeTheme.on('updated', handleNativeThemeUpdated);
  database = new EventDatabase(join(app.getPath('userData'), 'pulse-rn.sqlite'));
  mcpBridge = new McpBridge(
    app.getPath('userData'),
    {
      database: () => {
        if (!database) throw new Error('PulseRN database is not ready.');
        return database;
      },
      debugger: () => {
        if (!debuggerManager) throw new Error('PulseRN debugger is not ready.');
        return debuggerManager;
      },
      sessions,
      server: () => {
        if (!server) throw new Error('PulseRN device server is not ready.');
        return server;
      },
    },
    publishMcpInfo,
  );
  maintainDatabase(true);
  sessions.hydrate(database.recent());
  ipcMain.handle(SNAPSHOT_CHANNEL, () => sessions.snapshot());
  ipcMain.handle(MCP_CHANNEL, () => mcpInfo());
  ipcMain.handle(EVENTS_CHANNEL, async (_event, value: unknown) => {
    if (!database) throw new Error('PulseRN database is not ready.');
    const input = eventRequestSchema.parse(value);
    switch (input.operation) {
      case 'query':
        return database.query(input.input);
      case 'find':
        return database.findById(input.id);
      case 'listSavedFilters':
        return database.listSavedFilters();
      case 'saveEventFilter':
        return database.saveFilter(input.name, input.query, input.id);
      case 'deleteSavedFilter':
        return database.deleteSavedFilter(input.id);
      case 'listBookmarks':
        return database.listBookmarks(input.sessionId);
      case 'addBookmark':
        return database.addBookmark(input.eventId, input.label);
      case 'deleteBookmark':
        return database.deleteBookmark(input.id);
      case 'listAnnotations':
        return database.listAnnotations(input.eventId, input.sessionId);
      case 'saveAnnotation':
        return database.saveAnnotation(input.eventId, input.body, input.id);
      case 'deleteAnnotation':
        return database.deleteAnnotation(input.id);
      case 'networkCurl': {
        const event = database.findById(input.eventId);
        const payload = event ? networkEventPayloadSchema.safeParse(event.payload) : undefined;
        if (!payload?.success) throw new Error('The selected completed request does not exist.');
        return createCurlCommand(payload.data);
      }
      case 'exportNetworkHar': {
        const events = [];
        let cursor;
        do {
          const page = database.query({
            category: 'network',
            type: 'network.request',
            sessionId: input.sessionId,
            order: 'oldest',
            limit: 500,
            cursor,
          });
          events.push(...page.events);
          cursor = page.nextCursor;
        } while (cursor);
        const har = createSanitizedHar(events);
        const result = window
          ? await dialog.showSaveDialog(window, {
              title: 'Export sanitized network HAR',
              defaultPath: 'PulseRN-network.har',
              filters: [{ name: 'HTTP Archive', extensions: ['har'] }],
            })
          : await dialog.showSaveDialog({
              title: 'Export sanitized network HAR',
              defaultPath: 'PulseRN-network.har',
              filters: [{ name: 'HTTP Archive', extensions: ['har'] }],
            });
        if (result.canceled || !result.filePath) return { canceled: true, entries: 0 };
        await writeFile(result.filePath, `${JSON.stringify(har, null, 2)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
        return { canceled: false, filePath: result.filePath, entries: har.log.entries.length };
      }
      case 'sessions':
        return database.listSessions();
      case 'renameSession':
        return database.renameSession(input.sessionId, input.displayName);
      case 'deleteSession': {
        const confirmation = window
          ? await dialog.showMessageBox(window, {
              type: 'warning',
              title: 'Delete debugging session',
              message: 'Permanently delete this stored session and all of its events?',
              buttons: ['Cancel', 'Delete session'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            })
          : await dialog.showMessageBox({
              type: 'warning',
              title: 'Delete debugging session',
              message: 'Permanently delete this stored session and all of its events?',
              buttons: ['Cancel', 'Delete session'],
              defaultId: 0,
              cancelId: 0,
            });
        if (confirmation.response !== 1) throw new Error('Session deletion cancelled.');
        const result = database.deleteSession(input.sessionId);
        sessions.hydrate(database.recent());
        publish();
        return result;
      }
      case 'devices':
        return database.listDevices();
      case 'retentionState':
        return database.retentionState();
      case 'maintain':
        return maintainDatabase(true);
      case 'clear': {
        const options: Electron.MessageBoxOptions = {
          type: 'warning',
          title: 'Clear stored debugger events',
          message: 'Delete every event stored by PulseRN?',
          detail: 'This removes local debugger history from all sessions and cannot be undone.',
          buttons: ['Cancel', 'Delete all events'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        };
        const confirmation = window
          ? await dialog.showMessageBox(window, options)
          : await dialog.showMessageBox(options);
        if (confirmation.response !== 1) throw new Error('Event deletion cancelled.');
        const report = database.clear();
        sessions.hydrate([]);
        publish();
        return report;
      }
      case 'export': {
        const archive = createSessionArchive(database, input.sessionIds);
        const singleSession = archive.sessions.length === 1 ? archive.sessions[0]?.data : undefined;
        const result = window
          ? await dialog.showSaveDialog(window, {
              title: 'Export PulseRN archive',
              defaultPath: `${singleSession?.appName.replace(/[^A-Za-z0-9._-]+/g, '-') || 'PulseRN-sessions'}.pulsern`,
              filters: [{ name: 'PulseRN archive', extensions: ['pulsern'] }],
            })
          : await dialog.showSaveDialog({
              title: 'Export PulseRN archive',
              defaultPath: 'PulseRN-sessions.pulsern',
              filters: [{ name: 'PulseRN archive', extensions: ['pulsern'] }],
            });
        if (result.canceled || !result.filePath) {
          return { canceled: true, sessions: 0, events: 0 };
        }
        await writeFile(result.filePath, encodeSessionArchive(archive), { mode: 0o600 });
        return {
          canceled: false,
          filePath: result.filePath,
          sessions: archive.sessions.length,
          events: archive.events.length,
        };
      }
      case 'import': {
        const result = window
          ? await dialog.showOpenDialog(window, {
              title: 'Import PulseRN archive',
              properties: ['openFile'],
              filters: [{ name: 'PulseRN archive', extensions: ['pulsern'] }],
            })
          : await dialog.showOpenDialog({
              title: 'Import PulseRN archive',
              properties: ['openFile'],
              filters: [{ name: 'PulseRN archive', extensions: ['pulsern'] }],
            });
        const filePath = result.filePaths[0];
        if (result.canceled || !filePath) return { canceled: true, sessions: 0, events: 0 };
        const file = await stat(filePath);
        if (!file.isFile() || file.size > 100 * 1024 * 1024) {
          throw new Error('PulseRN archives must be files no larger than 100 MiB.');
        }
        const archive = decodeSessionArchive(await readFile(filePath));
        const imported = importSessionArchive(database, archive);
        maintainDatabase(true);
        sessions.hydrate(database.recent());
        publish();
        return { canceled: false, filePath, ...imported };
      }
    }
  });
  ipcMain.handle(STORAGE_CHANNEL, async (_event, value: unknown) => {
    const input = storageRequestSchema.parse(value);
    if (!server) throw new Error('PulseRN server is not ready.');
    if (!database) throw new Error('PulseRN database is not ready.');
    const activeDatabase = database;
    const isMutation = ['set', 'delete', 'restore'].includes(input.operation);
    if (isMutation) {
      const verb =
        input.operation === 'delete'
          ? 'Delete'
          : input.operation === 'restore'
            ? 'Restore'
            : 'Update';
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title: 'Confirm storage mutation',
        message: `${verb} "${input.key ?? ''}" in the connected app?`,
        detail:
          input.operation === 'restore'
            ? 'This restores the one-session backup and consumes it.'
            : 'This changes application data immediately. PulseRN keeps one opaque, session-only undo backup.',
        buttons: ['Cancel', verb],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const confirmation = window
        ? await dialog.showMessageBox(window, options)
        : await dialog.showMessageBox(options);
      if (confirmation.response !== 1) throw new Error('Storage mutation cancelled.');
    }
    try {
      const result = await server.requestStorage(input.connectionId, input);
      if (isMutation) {
        activeDatabase.recordStorageAudit({
          connectionId: input.connectionId,
          providerId: input.providerId,
          key: input.key ?? '',
          operation: input.operation as 'set' | 'delete' | 'restore',
          success: result.success,
          ...(result.backupId ? { backupId: result.backupId } : {}),
          ...(result.error ? { error: result.error } : {}),
        });
      }
      return result;
    } catch (error) {
      if (isMutation) {
        activeDatabase.recordStorageAudit({
          connectionId: input.connectionId,
          providerId: input.providerId,
          key: input.key ?? '',
          operation: input.operation as 'set' | 'delete' | 'restore',
          success: false,
          error: error instanceof Error ? error.message : 'Storage mutation failed.',
        });
      }
      throw error;
    }
  });
  ipcMain.handle(STORAGE_LOCAL_CHANNEL, async (_event, value: unknown) => {
    const input = storageLocalRequestSchema.parse(value);
    if (!database) throw new Error('PulseRN database is not ready.');
    const activeDatabase = database;
    if (input.operation === 'audit') return activeDatabase.listStorageAudit();
    if (input.operation === 'snapshot-list') {
      return activeDatabase.listStorageSnapshots(input.providerId, input.key);
    }
    if (input.operation === 'snapshot-delete') {
      return activeDatabase.deleteStorageSnapshot(input.id);
    }
    if (!server) throw new Error('PulseRN server is not ready.');
    if (input.operation === 'snapshot-create') {
      const result = await server.requestStorage(input.connectionId, {
        providerId: input.providerId,
        operation: 'get',
        key: input.key,
      });
      if (!result.success) throw new Error(result.error ?? 'Could not read the storage value.');
      if (
        result.value === null ||
        result.value === undefined ||
        result.sensitive ||
        result.redacted ||
        result.valueType === 'binary' ||
        result.value.includes('[REDACTED]')
      ) {
        throw new Error('Sensitive, redacted, binary, or missing values cannot be snapshotted.');
      }
      return activeDatabase.saveStorageSnapshot({
        connectionId: input.connectionId,
        providerId: input.providerId,
        key: input.key,
        value: result.value,
        valueType: result.valueType ?? 'unknown',
        valueSize: result.valueSize ?? Buffer.byteLength(result.value),
      });
    }
    const values: {
      providerId: string;
      key: string;
      value: string;
      valueType: string;
      valueSize: number;
    }[] = [];
    let excluded = 0;
    for (const item of input.items) {
      const result = await server.requestStorage(item.connectionId, {
        providerId: item.providerId,
        operation: 'get',
        key: item.key,
      });
      if (
        !result.success ||
        result.value === null ||
        result.value === undefined ||
        result.sensitive ||
        result.redacted ||
        result.valueType === 'binary' ||
        result.value.includes('[REDACTED]')
      ) {
        excluded += 1;
        continue;
      }
      values.push({
        providerId: item.providerId,
        key: item.key,
        value: result.value,
        valueType: result.valueType ?? 'unknown',
        valueSize: result.valueSize ?? Buffer.byteLength(result.value),
      });
    }
    const result = await dialog.showSaveDialog({
      title: 'Export selected storage values',
      defaultPath: `PulseRN-storage-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true, exported: 0, excluded };
    }
    await writeFile(
      result.filePath,
      `${JSON.stringify(
        {
          format: 'pulsern-storage-export',
          version: 1,
          exportedAt: Date.now(),
          values,
        },
        null,
        2,
      )}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    return {
      canceled: false,
      filePath: result.filePath,
      exported: values.length,
      excluded,
    };
  });
  ipcMain.handle(SETTINGS_CHANNEL, async (_event, value?: unknown) => {
    if (!settingsStore) throw new Error('PulseRN settings are not ready.');
    if (value === undefined) return settingsStore.get();
    const previous = settingsStore.get();
    const settings = settingsStore.update(value);
    if (settings.mcpEnabled !== previous.mcpEnabled) {
      try {
        if (settings.mcpEnabled) await mcpBridge?.start();
        else await mcpBridge?.stop();
      } catch (error) {
        settingsStore.update({ mcpEnabled: previous.mcpEnabled });
        throw error;
      }
    }
    const serverChanged =
      settings.allowLanConnections !== previous.allowLanConnections ||
      settings.devToolPort !== previous.devToolPort ||
      settings.tlsEnabled !== previous.tlsEnabled;
    if (serverChanged) {
      try {
        await restartServer(settings);
      } catch (error) {
        settingsStore.update({
          allowLanConnections: previous.allowLanConnections,
          devToolPort: previous.devToolPort,
          tlsEnabled: previous.tlsEnabled,
        });
        await restartServer(previous);
        throw error;
      }
    }
    nativeTheme.themeSource = settings.theme;
    updateManager?.setChannel(settings.updateChannel);
    applyAppIcon(settings.theme);
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    if (
      settings.checkForUpdatesAutomatically &&
      !previous.checkForUpdatesAutomatically &&
      updateManager?.snapshot().enabled
    ) {
      void updateManager.check();
    }
    maintainDatabase(true);
    if (window && !window.isDestroyed()) window.webContents.send(SETTINGS_CHANNEL, settings);
    publishMcpInfo();
    return settings;
  });
  ipcMain.handle(CONNECTION_CHANNEL, async (_event, value?: unknown) => {
    if (!pairingStore) throw new Error('PulseRN pairing store is not ready.');
    const input = z
      .discriminatedUnion('operation', [
        z.object({ operation: z.literal('info') }),
        z.object({ operation: z.literal('beginPairing') }),
        z.object({
          operation: z.literal('revoke'),
          appId: z.string().trim().min(1).max(256),
          deviceId: z.string().trim().min(1).max(256),
        }),
        z.object({ operation: z.literal('installTls') }),
        z.object({ operation: z.literal('disableTls') }),
      ])
      .parse(value ?? { operation: 'info' });
    if (input.operation === 'beginPairing') {
      const settings = settingsStore?.get();
      pairingStore.begin(
        Date.now(),
        settings?.pairingCodeLifetimeMinutes ?? 5,
        settings?.pairingRetryLimit ?? 5,
      );
      const info = connectionInfo();
      if (window && !window.isDestroyed()) window.webContents.send(CONNECTION_CHANNEL, info);
      return info;
    }
    if (input.operation === 'revoke') {
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title: 'Revoke trusted device',
        message: 'Revoke this device’s PulseRN reconnect token?',
        detail: 'The device must complete pairing again before it can connect over LAN.',
        buttons: ['Cancel', 'Revoke device'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const confirmation = window
        ? await dialog.showMessageBox(window, options)
        : await dialog.showMessageBox(options);
      if (confirmation.response !== 1) return connectionInfo();
      pairingStore.revoke(input.appId, input.deviceId);
      server?.disconnectDevice(input.appId, input.deviceId);
      const info = connectionInfo();
      if (window && !window.isDestroyed()) window.webContents.send(CONNECTION_CHANNEL, info);
      return info;
    }
    if (input.operation === 'installTls') {
      if (!settingsStore || !tlsCertificateStore) {
        throw new Error('PulseRN TLS settings are not ready.');
      }
      const certificateSelection = window
        ? await dialog.showOpenDialog(window, {
            title: 'Select TLS certificate',
            properties: ['openFile'],
            filters: [{ name: 'PEM certificate', extensions: ['pem', 'crt', 'cer'] }],
          })
        : await dialog.showOpenDialog({
            title: 'Select TLS certificate',
            properties: ['openFile'],
            filters: [{ name: 'PEM certificate', extensions: ['pem', 'crt', 'cer'] }],
          });
      const certificatePath = certificateSelection.filePaths[0];
      if (certificateSelection.canceled || !certificatePath) return connectionInfo();
      const keySelection = window
        ? await dialog.showOpenDialog(window, {
            title: 'Select TLS private key',
            properties: ['openFile'],
            filters: [{ name: 'PEM private key', extensions: ['pem', 'key'] }],
          })
        : await dialog.showOpenDialog({
            title: 'Select TLS private key',
            properties: ['openFile'],
            filters: [{ name: 'PEM private key', extensions: ['pem', 'key'] }],
          });
      const keyPath = keySelection.filePaths[0];
      if (keySelection.canceled || !keyPath) return connectionInfo();
      const previous = settingsStore.get();
      tlsCertificateStore.install(
        await readTlsCredentialFile(certificatePath),
        await readTlsCredentialFile(keyPath),
      );
      const next = settingsStore.update({ tlsEnabled: true });
      try {
        await restartServer(next);
      } catch (error) {
        settingsStore.update({ tlsEnabled: previous.tlsEnabled });
        await restartServer(previous);
        throw error;
      }
      if (window && !window.isDestroyed()) {
        window.webContents.send(SETTINGS_CHANNEL, next);
      }
      return connectionInfo();
    }
    if (input.operation === 'disableTls') {
      if (!settingsStore || !tlsCertificateStore) {
        throw new Error('PulseRN TLS settings are not ready.');
      }
      const previous = settingsStore.get();
      if (!previous.tlsEnabled) return connectionInfo();
      const confirmation = window
        ? await dialog.showMessageBox(window, {
            type: 'warning',
            title: 'Disable TLS',
            message: 'Switch device transport back to unencrypted WebSockets?',
            detail:
              'LAN token authentication remains enabled, but network traffic will be plaintext.',
            buttons: ['Cancel', 'Disable TLS'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          })
        : await dialog.showMessageBox({
            type: 'warning',
            title: 'Disable TLS',
            message: 'Switch device transport back to unencrypted WebSockets?',
            buttons: ['Cancel', 'Disable TLS'],
            defaultId: 0,
            cancelId: 0,
          });
      if (confirmation.response !== 1) return connectionInfo();
      const next = settingsStore.update({ tlsEnabled: false });
      try {
        await restartServer(next);
        tlsCertificateStore.remove();
      } catch (error) {
        settingsStore.update({ tlsEnabled: true });
        await restartServer(previous);
        throw error;
      }
      if (window && !window.isDestroyed()) {
        window.webContents.send(SETTINGS_CHANNEL, next);
      }
      return connectionInfo();
    }
    return connectionInfo();
  });
  ipcMain.handle(UPDATE_CHANNEL, async (_event, value?: unknown) => {
    if (!updateManager) throw new Error('PulseRN updates are not ready.');
    const input = z
      .discriminatedUnion('operation', [
        z.object({ operation: z.literal('state') }),
        z.object({ operation: z.literal('check') }),
        z.object({ operation: z.literal('download') }),
        z.object({ operation: z.literal('install') }),
      ])
      .parse(value ?? { operation: 'state' });
    if (input.operation === 'state') return updateManager.snapshot();
    if (input.operation === 'check') return updateManager.check();
    if (input.operation === 'download') return updateManager.download();
    const confirmation = window
      ? await dialog.showMessageBox(window, {
          type: 'info',
          title: 'Install PulseRN update',
          message: 'Restart PulseRN and install the downloaded update?',
          detail: 'Connected devices will disconnect while the application restarts.',
          buttons: ['Cancel', 'Restart and install'],
          defaultId: 1,
          cancelId: 0,
          noLink: true,
        })
      : await dialog.showMessageBox({
          type: 'info',
          title: 'Install PulseRN update',
          message: 'Restart PulseRN and install the downloaded update?',
          buttons: ['Cancel', 'Restart and install'],
          defaultId: 1,
          cancelId: 0,
        });
    if (confirmation.response !== 1) return updateManager.snapshot();
    return updateManager.install();
  });
  ipcMain.handle(DEBUGGER_CHANNEL, async (_event, value?: unknown) => {
    if (!debuggerManager) throw new Error('PulseRN debugger is not ready.');
    const input = z
      .discriminatedUnion('operation', [
        z.object({ operation: z.literal('state') }),
        z.object({ operation: z.literal('discover') }),
        z.object({ operation: z.literal('connect'), targetId: z.string().min(1).max(2048) }),
        z.object({ operation: z.literal('disconnect') }),
        z.object({ operation: z.literal('source'), sourceId: z.string().min(1).max(100_000) }),
        z.object({
          operation: z.literal('addBreakpoint'),
          sourceId: z.string().min(1).max(100_000),
          line: z.number().int().min(1).max(10_000_000),
          column: z.number().int().min(1).max(10_000_000),
          condition: z.string().max(10_000).optional(),
          hitCondition: z.number().int().positive().max(1_000_000).optional(),
          logMessage: z.string().max(10_000).optional(),
        }),
        z.object({ operation: z.literal('removeBreakpoint'), id: z.string().uuid() }),
        z.object({
          operation: z.literal('enableBreakpoint'),
          id: z.string().uuid(),
          enabled: z.boolean(),
        }),
        z.object({
          operation: z.literal('command'),
          command: z.enum(['pause', 'resume', 'stepOver', 'stepInto', 'stepOut']),
        }),
        z.object({ operation: z.literal('selectFrame'), id: z.string().min(1).max(100_000) }),
        z.object({ operation: z.literal('scope'), objectId: z.string().min(1).max(100_000) }),
        z.object({ operation: z.literal('properties'), objectId: z.string().min(1).max(100_000) }),
        z.object({
          operation: z.literal('addWatch'),
          expression: z.string().trim().min(1).max(10_000),
        }),
        z.object({ operation: z.literal('removeWatch'), id: z.string().uuid() }),
        z.object({
          operation: z.literal('evaluate'),
          expression: z.string().trim().min(1).max(10_000),
          options: z
            .object({
              frameId: z.string().min(1).max(100_000).optional(),
              allowRunning: z.boolean().optional(),
            })
            .optional(),
        }),
        z.object({
          operation: z.literal('releaseObject'),
          objectId: z.string().min(1).max(100_000),
        }),
        z.object({ operation: z.literal('reactComponents') }),
        z.object({
          operation: z.literal('reactComponentInteraction'),
          action: z.enum([
            'highlight',
            'hideHighlight',
            'startPicking',
            'stopPicking',
            'pollPicked',
          ]),
          componentId: z.string().min(1).max(256).optional(),
        }),
        z.object({
          operation: z.literal('pauseOnExceptions'),
          mode: z.enum(['none', 'uncaught', 'all']),
        }),
        z.object({ operation: z.literal('blackboxInternal'), enabled: z.boolean() }),
      ])
      .parse(value ?? { operation: 'state' });
    switch (input.operation) {
      case 'state':
        return debuggerManager.snapshot();
      case 'discover':
        return debuggerManager.discover();
      case 'connect':
        return debuggerManager.connect(input.targetId);
      case 'disconnect':
        return debuggerManager.disconnect();
      case 'source':
        return debuggerManager.getSource(input.sourceId);
      case 'addBreakpoint':
        return debuggerManager.addBreakpoint(input);
      case 'removeBreakpoint':
        return debuggerManager.removeBreakpoint(input.id);
      case 'enableBreakpoint':
        return debuggerManager.setBreakpointEnabled(input.id, input.enabled);
      case 'command':
        return debuggerManager.command(input.command);
      case 'selectFrame':
        return debuggerManager.selectCallFrame(input.id);
      case 'scope':
        return debuggerManager.getScope(input.objectId);
      case 'properties':
        return debuggerManager.getProperties(input.objectId);
      case 'addWatch':
        return debuggerManager.addWatch(input.expression);
      case 'removeWatch':
        return debuggerManager.removeWatch(input.id);
      case 'evaluate':
        return debuggerManager.evaluate(input.expression, input.options);
      case 'releaseObject':
        return debuggerManager.releaseObject(input.objectId);
      case 'reactComponents':
        return debuggerManager.getReactComponentSnapshot();
      case 'reactComponentInteraction':
        return debuggerManager.interactWithReactComponent(input.action, input.componentId);
      case 'pauseOnExceptions':
        return debuggerManager.setPauseOnExceptions(input.mode);
      case 'blackboxInternal':
        return debuggerManager.setBlackboxInternal(input.enabled);
    }
  });
  await restartServer();
  if (initialSettings.mcpEnabled) await mcpBridge.start();
  createWindow();
  if (initialSettings.checkForUpdatesAutomatically && updateManager.snapshot().enabled) {
    automaticUpdateTimer = setTimeout(() => void updateManager?.check(), 5_000);
  }
  app.on('activate', () => {
    if (window && !window.isDestroyed()) window.show();
    else createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  isQuitting = true;
  if (!shutdownPromise) {
    ipcMain.removeHandler(SNAPSHOT_CHANNEL);
    ipcMain.removeHandler(EVENTS_CHANNEL);
    ipcMain.removeHandler(STORAGE_CHANNEL);
    ipcMain.removeHandler(SETTINGS_CHANNEL);
    ipcMain.removeHandler(DEBUGGER_CHANNEL);
    ipcMain.removeHandler(CONNECTION_CHANNEL);
    ipcMain.removeHandler(UPDATE_CHANNEL);
    ipcMain.removeHandler(MCP_CHANNEL);
    if (automaticUpdateTimer) clearTimeout(automaticUpdateTimer);
    nativeTheme.removeListener('updated', handleNativeThemeUpdated);
    debuggerManager?.close();
    debuggerManager = undefined;

    const activeServer = server;
    server = undefined;
    const activeMcpBridge = mcpBridge;
    mcpBridge = undefined;
    shutdownPromise = (async () => {
      try {
        await activeMcpBridge?.stop();
      } catch (error) {
        console.warn('[PulseRN] MCP shutdown failed:', error);
      }
      try {
        await activeServer?.close();
      } catch (error) {
        console.warn('[PulseRN] WebSocket shutdown failed:', error);
      }

      const activeDatabase = database;
      database = undefined;
      activeDatabase?.close();
    })().finally(() => {
      shutdownComplete = true;
      app.quit();
    });
  }
});
