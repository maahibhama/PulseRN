import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';
import {
  clientHealthSchema,
  deviceInfoSchema,
  eventCategorySchema,
  eventEnvelopeSchema,
  storageOperationSchema,
  storageResultSchema,
} from '@pulse-rn/protocol';
import type { AppSettings, DebuggerState, PulseRNDesktopApi } from './api.js';

const SNAPSHOT_CHANNEL = 'pulse-rn:snapshot';
const DEVICES_CHANNEL = 'pulse-rn:devices';
const EVENTS_CHANNEL = 'pulse-rn:events';
const STORAGE_CHANNEL = 'pulse-rn:storage';
const SETTINGS_CHANNEL = 'pulse-rn:settings';
const DEBUGGER_CHANNEL = 'pulse-rn:debugger';
const CONNECTION_CHANNEL = 'pulse-rn:connection';
const UPDATE_CHANNEL = 'pulse-rn:update';
const connectedDeviceSchema = z.object({
  connectionId: z.string(),
  deviceId: z.string(),
  sessionId: z.string(),
  appId: z.string(),
  protocolVersion: z.string().optional(),
  trustStatus: z.enum(['loopback', 'paired', 'trusted', 'legacy']).optional(),
  remoteAddress: z.string().optional(),
  connectedAt: z.number().finite().nonnegative(),
  device: deviceInfoSchema,
  health: clientHealthSchema
    .extend({
      receivedAt: z.number().finite().nonnegative(),
    })
    .optional(),
});
const snapshotSchema = z.object({
  devices: z.array(connectedDeviceSchema),
  events: z.array(eventEnvelopeSchema),
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
const savedEventFilterSchema = z.object({
  id: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(128),
  query: savedEventQuerySchema,
  createdAt: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
});
const eventBookmarkSchema = z.object({
  id: z.string().trim().min(1).max(256),
  eventId: z.string().trim().min(1).max(256),
  sessionId: z.string().trim().min(1).max(256),
  label: z.string().max(256).optional(),
  createdAt: z.number().finite().nonnegative(),
});
const eventAnnotationSchema = z.object({
  id: z.string().trim().min(1).max(256),
  eventId: z.string().trim().min(1).max(256),
  sessionId: z.string().trim().min(1).max(256),
  body: z.string().trim().min(1).max(10_000),
  createdAt: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
});
const eventPageSchema = z.object({
  events: z.array(eventEnvelopeSchema),
  hasMore: z.boolean(),
  hasNext: z.boolean(),
  hasPrevious: z.boolean(),
  nextCursor: eventCursorSchema.optional(),
  previousCursor: eventCursorSchema.optional(),
  total: z.number().int().nonnegative(),
});
const storedSessionSchema = z.object({
  sessionId: z.string(),
  appId: z.string(),
  deviceId: z.string(),
  appName: z.string(),
  deviceName: z.string(),
  platform: z.string(),
  startedAt: z.number().finite().nonnegative(),
  lastSeenAt: z.number().finite().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  appVersion: z.string().optional(),
  sdkVersion: z.string().optional(),
  protocolVersion: z.string().optional(),
  endedAt: z.number().finite().nonnegative().optional(),
  connectionCount: z.number().int().nonnegative(),
  displayName: z.string().optional(),
  trustStatus: z.string().optional(),
  disconnectCode: z.number().int().nonnegative().optional(),
  disconnectReason: z.string().optional(),
});
const storedDeviceSchema = z.object({
  deviceId: z.string(),
  appId: z.string(),
  name: z.string(),
  appName: z.string(),
  platform: z.string(),
  platformVersion: z.string().optional(),
  model: z.string().optional(),
  appVersion: z.string().optional(),
  sdkVersion: z.string(),
  firstSeenAt: z.number().finite().nonnegative(),
  lastSeenAt: z.number().finite().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
});
const retentionStateSchema = z.object({
  maxAgeDays: z.number().int().min(1).max(365),
  maxEvents: z.number().int().min(1_000).max(1_000_000),
  lastRunAt: z.number().finite().nonnegative(),
});
const storageRequestSchema = z.object({
  connectionId: z.string().trim().min(1).max(256),
  providerId: z.string().trim().min(1).max(256),
  operation: storageOperationSchema,
  key: z.string().max(10_000).optional(),
  value: z.string().max(1_000_000).optional(),
  cursor: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
const settingsSchema = z.object({
  theme: z.enum(['system', 'dark', 'light']),
  density: z.enum(['comfortable', 'compact']),
  timelineOrder: z.enum(['newest', 'oldest']),
  metroPort: z.number().int().min(1).max(65_535),
  devToolPort: z.number().int().min(1_024).max(65_535),
  allowLanConnections: z.boolean(),
  tlsEnabled: z.boolean(),
  eventRetentionDays: z.number().int().min(1).max(365),
  maxStoredEvents: z.number().int().min(1_000).max(1_000_000),
  checkForUpdatesAutomatically: z.boolean(),
  launchAtLogin: z.boolean(),
  keepRunningInBackground: z.boolean(),
});
const databaseMaintenanceSchema = z.object({
  integrity: z.enum(['ok', 'recovered']),
  removedExpired: z.number().int().nonnegative(),
  removedOverflow: z.number().int().nonnegative(),
  removedInvalid: z.number().int().nonnegative(),
  retainedEvents: z.number().int().nonnegative(),
  completedAt: z.number().finite().nonnegative(),
  recovery: z
    .object({
      status: z.enum(['not-needed', 'recovered']),
      backupPath: z.string().optional(),
      recoveredEvents: z.number().int().nonnegative(),
      recoveredSessions: z.number().int().nonnegative(),
      lostEvents: z.number().int().nonnegative(),
      lossesUnknown: z.boolean(),
      reason: z.string().optional(),
    })
    .optional(),
});
const sessionArchiveResultSchema = z.object({
  canceled: z.boolean(),
  filePath: z.string().optional(),
  sessions: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
});
const networkExportResultSchema = z.object({
  canceled: z.boolean(),
  filePath: z.string().optional(),
  entries: z.number().int().nonnegative(),
});
const settingsPatchSchema = settingsSchema.partial().strict();
const connectionInfoSchema = z.object({
  mode: z.enum(['loopback', 'lan']),
  port: z.number().int().min(1_024).max(65_535),
  requiresAuth: z.boolean(),
  addresses: z.array(z.string().max(2_048)).max(100),
  pairing: z
    .object({
      code: z.string().max(64),
      expiresAt: z.number().finite().nonnegative(),
      remainingAttempts: z.number().int().nonnegative(),
    })
    .optional(),
  trustedDevices: z.array(
    z.object({
      appId: z.string(),
      deviceId: z.string(),
      appName: z.string(),
      deviceName: z.string(),
      createdAt: z.number().finite().nonnegative(),
      lastUsedAt: z.number().finite().nonnegative(),
      revokedAt: z.number().finite().nonnegative().optional(),
      status: z.enum(['trusted', 'revoked']),
    }),
  ),
  tls: z.object({
    enabled: z.boolean(),
    configured: z.boolean(),
    fingerprint256: z.string().optional(),
    subject: z.string().optional(),
    issuer: z.string().optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
  }),
});
const updateStateSchema = z.object({
  enabled: z.boolean(),
  status: z.enum([
    'disabled',
    'idle',
    'checking',
    'available',
    'downloading',
    'downloaded',
    'up-to-date',
    'installing',
    'error',
  ]),
  currentVersion: z.string().max(100),
  availableVersion: z.string().max(100).optional(),
  progress: z.number().min(0).max(100).optional(),
  message: z.string().max(2_000).optional(),
});
const debuggerLocationSchema = z.object({
  sourceId: z.string(),
  line: z.number().int().min(1),
  column: z.number().int().min(1),
});
const remoteValueSchema = z.object({
  type: z.string(),
  description: z.string(),
  value: z.unknown().optional(),
  objectId: z.string().optional(),
});
const debuggerStateSchema = z.object({
  status: z.enum(['disconnected', 'discovering', 'connecting', 'connected', 'paused', 'error']),
  targets: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      appId: z.string().optional(),
      deviceName: z.string().optional(),
    }),
  ),
  activeTargetId: z.string().optional(),
  sources: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      name: z.string(),
      internal: z.boolean(),
      original: z.boolean(),
    }),
  ),
  breakpoints: z.array(
    debuggerLocationSchema.extend({
      id: z.string(),
      appId: z.string().optional(),
      enabled: z.boolean(),
      condition: z.string().optional(),
      verified: z.boolean(),
      error: z.string().optional(),
    }),
  ),
  callFrames: z.array(
    z.object({
      id: z.string(),
      functionName: z.string(),
      location: debuggerLocationSchema,
      scopes: z.array(
        z.object({
          type: z.string(),
          name: z.string().optional(),
          objectId: z.string().optional(),
        }),
      ),
    }),
  ),
  selectedCallFrameId: z.string().optional(),
  watches: z.array(
    z.object({
      id: z.string(),
      expression: z.string(),
      result: remoteValueSchema.optional(),
      error: z.string().optional(),
    }),
  ),
  pauseOnExceptions: z.enum(['none', 'uncaught', 'all']),
  pauseReason: z.string().optional(),
  error: z.string().optional(),
});
const debuggerPropertySchema = z.array(
  z.object({
    name: z.string(),
    value: remoteValueSchema,
  }),
);

async function invokeDebugger(value: unknown): Promise<unknown> {
  return ipcRenderer.invoke(DEBUGGER_CHANNEL, value);
}

const api: PulseRNDesktopApi = {
  async getSnapshot() {
    const value: unknown = await ipcRenderer.invoke(SNAPSHOT_CHANNEL);
    return snapshotSchema.parse(value) as Awaited<ReturnType<PulseRNDesktopApi['getSnapshot']>>;
  },
  onSnapshot(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const result = snapshotSchema.safeParse(value);
      if (result.success) listener(result.data as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(SNAPSHOT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(SNAPSHOT_CHANNEL, handler);
  },
  onDevices(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const result = z.array(connectedDeviceSchema).safeParse(value);
      if (result.success) listener(result.data);
    };
    ipcRenderer.on(DEVICES_CHANNEL, handler);
    return () => ipcRenderer.removeListener(DEVICES_CHANNEL, handler);
  },
  async queryEvents(input = {}) {
    const request = eventQuerySchema.parse(input);
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'query',
      input: request,
    });
    return eventPageSchema.parse(value);
  },
  async getEvent(id) {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'find',
      id: z.string().trim().min(1).max(256).parse(id),
    });
    return value === undefined ? undefined : eventEnvelopeSchema.parse(value);
  },
  async listSavedFilters() {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'listSavedFilters',
    });
    return z.array(savedEventFilterSchema).parse(value);
  },
  async saveEventFilter(name, query, id) {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'saveEventFilter',
      name: z.string().trim().min(1).max(128).parse(name),
      query: savedEventQuerySchema.parse(query),
      id: id ? z.string().trim().min(1).max(256).parse(id) : undefined,
    });
    return savedEventFilterSchema.parse(value);
  },
  async deleteSavedFilter(id) {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'deleteSavedFilter',
      id: z.string().trim().min(1).max(256).parse(id),
    });
    return z.boolean().parse(value);
  },
  async listBookmarks(sessionId) {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'listBookmarks',
      sessionId: sessionId ? z.string().trim().min(1).max(256).parse(sessionId) : undefined,
    });
    return z.array(eventBookmarkSchema).parse(value);
  },
  async addBookmark(eventId, label) {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'addBookmark',
      eventId: z.string().trim().min(1).max(256).parse(eventId),
      label: label ? z.string().trim().max(256).parse(label) : undefined,
    });
    return eventBookmarkSchema.parse(value);
  },
  async deleteBookmark(id) {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'deleteBookmark',
      id: z.string().trim().min(1).max(256).parse(id),
    });
    return z.boolean().parse(value);
  },
  async listAnnotations(eventId, sessionId) {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'listAnnotations',
      eventId: eventId ? z.string().trim().min(1).max(256).parse(eventId) : undefined,
      sessionId: sessionId ? z.string().trim().min(1).max(256).parse(sessionId) : undefined,
    });
    return z.array(eventAnnotationSchema).parse(value);
  },
  async saveAnnotation(eventId, body, id) {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'saveAnnotation',
      eventId: z.string().trim().min(1).max(256).parse(eventId),
      body: z.string().trim().min(1).max(10_000).parse(body),
      id: id ? z.string().trim().min(1).max(256).parse(id) : undefined,
    });
    return eventAnnotationSchema.parse(value);
  },
  async deleteAnnotation(id) {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'deleteAnnotation',
      id: z.string().trim().min(1).max(256).parse(id),
    });
    return z.boolean().parse(value);
  },
  async getNetworkCurl(eventId) {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'networkCurl',
      eventId: z.string().trim().min(1).max(256).parse(eventId),
    });
    return z.string().max(2_000_000).parse(value);
  },
  async exportNetworkHar(sessionId) {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'exportNetworkHar',
      sessionId: sessionId ? z.string().trim().min(1).max(256).parse(sessionId) : undefined,
    });
    return networkExportResultSchema.parse(value);
  },
  async listSessions() {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'sessions',
    });
    return z.array(storedSessionSchema).parse(value);
  },
  async renameSession(sessionId, displayName) {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'renameSession',
      sessionId: z.string().trim().min(1).max(256).parse(sessionId),
      displayName: z.string().trim().min(1).max(256).parse(displayName),
    });
    return storedSessionSchema.parse(value);
  },
  async deleteSession(sessionId) {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'deleteSession',
      sessionId: z.string().trim().min(1).max(256).parse(sessionId),
    });
    return z
      .object({
        sessions: z.number().int().nonnegative(),
        events: z.number().int().nonnegative(),
      })
      .parse(value);
  },
  async listStoredDevices() {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'devices',
    });
    return z.array(storedDeviceSchema).parse(value);
  },
  async getRetentionState() {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'retentionState',
    });
    return value === undefined ? undefined : retentionStateSchema.parse(value);
  },
  async exportSessions(sessionIds) {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'export',
      sessionIds: sessionIds
        ? z.array(z.string().trim().min(1).max(256)).min(1).max(500).parse(sessionIds)
        : undefined,
    });
    return sessionArchiveResultSchema.parse(value);
  },
  async importSessions() {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'import',
    });
    return sessionArchiveResultSchema.parse(value);
  },
  async runDatabaseMaintenance() {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'maintain',
    });
    return databaseMaintenanceSchema.parse(value);
  },
  async clearStoredEvents() {
    const value: unknown = await ipcRenderer.invoke(EVENTS_CHANNEL, {
      operation: 'clear',
    });
    return databaseMaintenanceSchema.parse(value);
  },
  async requestStorage(input) {
    const request = storageRequestSchema.parse(input);
    const value: unknown = await ipcRenderer.invoke(STORAGE_CHANNEL, request);
    return storageResultSchema.parse(value);
  },
  async getSettings() {
    const value: unknown = await ipcRenderer.invoke(SETTINGS_CHANNEL);
    return settingsSchema.parse(value);
  },
  async updateSettings(patch) {
    const value: unknown = await ipcRenderer.invoke(
      SETTINGS_CHANNEL,
      settingsPatchSchema.parse(patch),
    );
    return settingsSchema.parse(value);
  },
  onSettings(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const result = settingsSchema.safeParse(value);
      if (result.success) listener(result.data as AppSettings);
    };
    ipcRenderer.on(SETTINGS_CHANNEL, handler);
    return () => ipcRenderer.removeListener(SETTINGS_CHANNEL, handler);
  },
  async getConnectionInfo() {
    return connectionInfoSchema.parse(
      await ipcRenderer.invoke(CONNECTION_CHANNEL, { operation: 'info' }),
    );
  },
  async beginPairing() {
    return connectionInfoSchema.parse(
      await ipcRenderer.invoke(CONNECTION_CHANNEL, { operation: 'beginPairing' }),
    );
  },
  async revokeTrustedDevice(appId, deviceId) {
    return connectionInfoSchema.parse(
      await ipcRenderer.invoke(CONNECTION_CHANNEL, {
        operation: 'revoke',
        appId: z.string().trim().min(1).max(256).parse(appId),
        deviceId: z.string().trim().min(1).max(256).parse(deviceId),
      }),
    );
  },
  async installTlsCertificate() {
    return connectionInfoSchema.parse(
      await ipcRenderer.invoke(CONNECTION_CHANNEL, { operation: 'installTls' }),
    );
  },
  async disableTls() {
    return connectionInfoSchema.parse(
      await ipcRenderer.invoke(CONNECTION_CHANNEL, { operation: 'disableTls' }),
    );
  },
  onConnectionInfo(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const result = connectionInfoSchema.safeParse(value);
      if (result.success) listener(result.data);
    };
    ipcRenderer.on(CONNECTION_CHANNEL, handler);
    return () => ipcRenderer.removeListener(CONNECTION_CHANNEL, handler);
  },
  async getUpdateState() {
    return updateStateSchema.parse(
      await ipcRenderer.invoke(UPDATE_CHANNEL, { operation: 'state' }),
    );
  },
  async checkForUpdates() {
    return updateStateSchema.parse(
      await ipcRenderer.invoke(UPDATE_CHANNEL, { operation: 'check' }),
    );
  },
  async downloadUpdate() {
    return updateStateSchema.parse(
      await ipcRenderer.invoke(UPDATE_CHANNEL, { operation: 'download' }),
    );
  },
  async installUpdate() {
    return updateStateSchema.parse(
      await ipcRenderer.invoke(UPDATE_CHANNEL, { operation: 'install' }),
    );
  },
  onUpdateState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const result = updateStateSchema.safeParse(value);
      if (result.success) listener(result.data);
    };
    ipcRenderer.on(UPDATE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(UPDATE_CHANNEL, handler);
  },
  async getDebuggerState() {
    return debuggerStateSchema.parse(await invokeDebugger({ operation: 'state' }));
  },
  onDebuggerState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const result = debuggerStateSchema.safeParse(value);
      if (result.success) listener(result.data as DebuggerState);
    };
    ipcRenderer.on(DEBUGGER_CHANNEL, handler);
    return () => ipcRenderer.removeListener(DEBUGGER_CHANNEL, handler);
  },
  async discoverDebuggerTargets() {
    return debuggerStateSchema.parse(await invokeDebugger({ operation: 'discover' }));
  },
  async connectDebugger(targetId) {
    return debuggerStateSchema.parse(
      await invokeDebugger({ operation: 'connect', targetId: z.string().parse(targetId) }),
    );
  },
  async disconnectDebugger() {
    return debuggerStateSchema.parse(await invokeDebugger({ operation: 'disconnect' }));
  },
  async getDebuggerSource(sourceId) {
    return z
      .string()
      .parse(await invokeDebugger({ operation: 'source', sourceId: z.string().parse(sourceId) }));
  },
  async addDebuggerBreakpoint(input) {
    return debuggerStateSchema.parse(
      await invokeDebugger({
        operation: 'addBreakpoint',
        ...debuggerLocationSchema
          .extend({ condition: z.string().max(10_000).optional() })
          .parse(input),
      }),
    );
  },
  async removeDebuggerBreakpoint(id) {
    return debuggerStateSchema.parse(
      await invokeDebugger({ operation: 'removeBreakpoint', id: z.string().uuid().parse(id) }),
    );
  },
  async setDebuggerBreakpointEnabled(id, enabled) {
    return debuggerStateSchema.parse(
      await invokeDebugger({
        operation: 'enableBreakpoint',
        id: z.string().uuid().parse(id),
        enabled: z.boolean().parse(enabled),
      }),
    );
  },
  async debuggerCommand(command) {
    return debuggerStateSchema.parse(
      await invokeDebugger({
        operation: 'command',
        command: z.enum(['pause', 'resume', 'stepOver', 'stepInto', 'stepOut']).parse(command),
      }),
    );
  },
  async selectDebuggerCallFrame(id) {
    return debuggerStateSchema.parse(
      await invokeDebugger({ operation: 'selectFrame', id: z.string().parse(id) }),
    );
  },
  async getDebuggerScope(objectId) {
    return debuggerPropertySchema.parse(
      await invokeDebugger({ operation: 'scope', objectId: z.string().parse(objectId) }),
    );
  },
  async addDebuggerWatch(expression) {
    return debuggerStateSchema.parse(
      await invokeDebugger({
        operation: 'addWatch',
        expression: z.string().trim().min(1).max(10_000).parse(expression),
      }),
    );
  },
  async removeDebuggerWatch(id) {
    return debuggerStateSchema.parse(
      await invokeDebugger({ operation: 'removeWatch', id: z.string().uuid().parse(id) }),
    );
  },
  async evaluateDebuggerExpression(expression) {
    return remoteValueSchema.parse(
      await invokeDebugger({
        operation: 'evaluate',
        expression: z.string().trim().min(1).max(10_000).parse(expression),
      }),
    );
  },
  async setPauseOnExceptions(mode) {
    return debuggerStateSchema.parse(
      await invokeDebugger({
        operation: 'pauseOnExceptions',
        mode: z.enum(['none', 'uncaught', 'all']).parse(mode),
      }),
    );
  },
};

contextBridge.exposeInMainWorld('pulseRN', api);
