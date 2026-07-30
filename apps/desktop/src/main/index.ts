import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { storageOperationSchema } from '@pulse-rn/protocol';
import { z } from 'zod';
import { EventDatabase } from './database.js';
import { SessionManager } from './session-manager.js';
import { DevToolWebSocketServer } from './websocket-server.js';

const SNAPSHOT_CHANNEL = 'pulse-rn:snapshot';
const STORAGE_CHANNEL = 'pulse-rn:storage';
const storageRequestSchema = z.object({
  connectionId: z.string().trim().min(1).max(256),
  providerId: z.string().trim().min(1).max(256),
  operation: storageOperationSchema,
  key: z.string().max(10_000).optional(),
  value: z.string().max(1_000_000).optional(),
});
const sessions = new SessionManager();
let database: EventDatabase | undefined;
let server: DevToolWebSocketServer | undefined;
let window: BrowserWindow | undefined;

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
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
  database = new EventDatabase(join(app.getPath('userData'), 'pulse-rn.sqlite'));
  sessions.hydrate(database.recent());
  ipcMain.handle(SNAPSHOT_CHANNEL, () => sessions.snapshot());
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
  server = new DevToolWebSocketServer(9090, {
    onConnected(device) {
      sessions.connect(device);
      publish();
    },
    onDisconnected(connectionId) {
      sessions.disconnect(connectionId);
      publish();
    },
    onEvents(events) {
      database?.insertMany(events);
      sessions.append(events);
      publish();
    },
    onInvalidMessage(error) {
      console.warn('[PulseRN] Rejected invalid client message:', error);
    },
  });
  await server.start();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  ipcMain.removeHandler(SNAPSHOT_CHANNEL);
  ipcMain.removeHandler(STORAGE_CHANNEL);
  void server?.close();
  database?.close();
});
