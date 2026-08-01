import { isAbsolute, join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import { eventCategorySchema, storageOperationSchema } from '@pulse-rn/protocol';
import { z } from 'zod';
import { EventDatabase } from './database.js';
import { SessionManager } from './session-manager.js';
import { SettingsStore } from './settings.js';
import { DevToolWebSocketServer } from './websocket-server.js';
import { DebuggerManager } from './debugger-manager.js';

const SNAPSHOT_CHANNEL = 'pulse-rn:snapshot';
const DEVICES_CHANNEL = 'pulse-rn:devices';
const EVENTS_CHANNEL = 'pulse-rn:events';
const STORAGE_CHANNEL = 'pulse-rn:storage';
const SETTINGS_CHANNEL = 'pulse-rn:settings';
const DEBUGGER_CHANNEL = 'pulse-rn:debugger';
const DARK_APP_ICON = join(__dirname, '../../resources/pulse-rn-app-icon-dark.png');
const LIGHT_APP_ICON = join(__dirname, '../../resources/pulse-rn-app-icon-light.png');
const e2eUserDataDirectory = process.env['PULSE_RN_E2E_USER_DATA_DIR'];
if (!app.isPackaged && e2eUserDataDirectory && isAbsolute(e2eUserDataDirectory)) {
  app.setPath('userData', e2eUserDataDirectory);
}
const configuredServerPort = Number(process.env['PULSE_RN_E2E_SERVER_PORT']);
const serverPort =
  !app.isPackaged &&
  Number.isInteger(configuredServerPort) &&
  configuredServerPort >= 1_024 &&
  configuredServerPort <= 65_535
    ? configuredServerPort
    : 9090;
const storageRequestSchema = z.object({
  connectionId: z.string().trim().min(1).max(256),
  providerId: z.string().trim().min(1).max(256),
  operation: storageOperationSchema,
  key: z.string().max(10_000).optional(),
  value: z.string().max(1_000_000).optional(),
});
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
    deviceId: z.string().trim().min(1).max(256).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    order: z.enum(['newest', 'oldest']).optional(),
    sessionId: z.string().trim().min(1).max(256).optional(),
  })
  .strict();
const eventRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('query'), input: eventQuerySchema }),
  z.object({ operation: z.literal('find'), id: z.string().trim().min(1).max(256) }),
  z.object({ operation: z.literal('sessions') }),
  z.object({ operation: z.literal('maintain') }),
  z.object({ operation: z.literal('clear') }),
]);
const sessions = new SessionManager();
let database: EventDatabase | undefined;
let server: DevToolWebSocketServer | undefined;
let window: BrowserWindow | undefined;
let settingsStore: SettingsStore | undefined;
let debuggerManager: DebuggerManager | undefined;
let isQuitting = false;
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
  debuggerManager = new DebuggerManager(
    join(app.getPath('userData'), 'debugger.json'),
    () => settingsStore?.get().metroPort ?? 8081,
    (state) => {
      if (window && !window.isDestroyed()) window.webContents.send(DEBUGGER_CHANNEL, state);
    },
  );
  const initialSettings = settingsStore.get();
  nativeTheme.themeSource = initialSettings.theme;
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: initialSettings.launchAtLogin });
  applyAppIcon(initialSettings.theme);
  nativeTheme.on('updated', handleNativeThemeUpdated);
  database = new EventDatabase(join(app.getPath('userData'), 'pulse-rn.sqlite'));
  maintainDatabase(true);
  sessions.hydrate(database.recent());
  ipcMain.handle(SNAPSHOT_CHANNEL, () => sessions.snapshot());
  ipcMain.handle(EVENTS_CHANNEL, async (_event, value: unknown) => {
    if (!database) throw new Error('PulseRN database is not ready.');
    const input = eventRequestSchema.parse(value);
    switch (input.operation) {
      case 'query':
        return database.query(input.input);
      case 'find':
        return database.findById(input.id);
      case 'sessions':
        return database.listSessions();
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
    }
  });
  ipcMain.handle(STORAGE_CHANNEL, async (_event, value: unknown) => {
    const input = storageRequestSchema.parse(value);
    if (!server) throw new Error('PulseRN server is not ready.');
    if (input.operation === 'set' || input.operation === 'delete') {
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title: 'Confirm storage mutation',
        message:
          input.operation === 'delete'
            ? `Delete "${input.key ?? ''}" from the connected app?`
            : `Update "${input.key ?? ''}" in the connected app?`,
        detail: 'This changes application data immediately and cannot be undone by PulseRN.',
        buttons: ['Cancel', input.operation === 'delete' ? 'Delete' : 'Update'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const confirmation = window
        ? await dialog.showMessageBox(window, options)
        : await dialog.showMessageBox(options);
      if (confirmation.response !== 1) throw new Error('Storage mutation cancelled.');
    }
    return server.requestStorage(input.connectionId, input);
  });
  ipcMain.handle(SETTINGS_CHANNEL, (_event, value?: unknown) => {
    if (!settingsStore) throw new Error('PulseRN settings are not ready.');
    if (value === undefined) return settingsStore.get();
    const settings = settingsStore.update(value);
    nativeTheme.themeSource = settings.theme;
    applyAppIcon(settings.theme);
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    maintainDatabase(true);
    if (window && !window.isDestroyed()) window.webContents.send(SETTINGS_CHANNEL, settings);
    return settings;
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
        z.object({
          operation: z.literal('addWatch'),
          expression: z.string().trim().min(1).max(10_000),
        }),
        z.object({ operation: z.literal('removeWatch'), id: z.string().uuid() }),
        z.object({
          operation: z.literal('evaluate'),
          expression: z.string().trim().min(1).max(10_000),
        }),
        z.object({
          operation: z.literal('pauseOnExceptions'),
          mode: z.enum(['none', 'uncaught', 'all']),
        }),
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
      case 'addWatch':
        return debuggerManager.addWatch(input.expression);
      case 'removeWatch':
        return debuggerManager.removeWatch(input.id);
      case 'evaluate':
        return debuggerManager.evaluate(input.expression);
      case 'pauseOnExceptions':
        return debuggerManager.setPauseOnExceptions(input.mode);
    }
  });
  server = new DevToolWebSocketServer(serverPort, {
    onConnected(device) {
      database?.recordSession(device);
      sessions.connect(device);
      publish();
    },
    onDisconnected(connectionId) {
      sessions.disconnect(connectionId);
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
  });
  await server.start();
  createWindow();
  app.on('activate', () => {
    if (window && !window.isDestroyed()) window.show();
    else createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  ipcMain.removeHandler(SNAPSHOT_CHANNEL);
  ipcMain.removeHandler(EVENTS_CHANNEL);
  ipcMain.removeHandler(STORAGE_CHANNEL);
  ipcMain.removeHandler(SETTINGS_CHANNEL);
  ipcMain.removeHandler(DEBUGGER_CHANNEL);
  nativeTheme.removeListener('updated', handleNativeThemeUpdated);
  void server?.close();
  debuggerManager?.close();
  database?.close();
});
