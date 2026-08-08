import type { PulseRNDesktopApi } from '../../preload/api.js';

type Subscription =
  | 'snapshot'
  | 'devices'
  | 'native-logs'
  | 'settings'
  | 'appearance'
  | 'connection'
  | 'debugger'
  | 'mcp'
  | 'update';

interface LiveMessage {
  type: Subscription;
  value: unknown;
}

const listeners = new Map<Subscription, Set<(value: never) => void>>();
let liveSocket: WebSocket | undefined;

function emit(message: LiveMessage): void {
  for (const listener of listeners.get(message.type) ?? []) listener(message.value as never);
}

function connectLive(): void {
  if (liveSocket && liveSocket.readyState <= WebSocket.OPEN) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  liveSocket = new WebSocket(`${protocol}//${location.host}/live`);
  liveSocket.addEventListener('message', (event) => {
    try {
      emit(JSON.parse(String(event.data)) as LiveMessage);
    } catch {
      // The server validates outbound messages; ignore a damaged browser frame.
    }
  });
  liveSocket.addEventListener('close', () => {
    liveSocket = undefined;
    window.setTimeout(connectLive, 1_000);
  });
}

function subscribe(type: Subscription, listener: (value: never) => void): () => void {
  const entries = listeners.get(type) ?? new Set();
  entries.add(listener);
  listeners.set(type, entries);
  connectLive();
  return () => entries.delete(listener);
}

async function call<T>(method: string, args: unknown[] = []): Promise<T> {
  const response = await fetch('/api/v1/call', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args }),
  });
  const body = (await response.json()) as {
    ok: boolean;
    value?: T;
    error?: string;
    download?: { name: string; type: string; base64: string };
  };
  if (!response.ok || !body.ok)
    throw new Error(body.error ?? `PulseRN request failed (${response.status}).`);
  if (body.download) {
    const bytes = Uint8Array.from(atob(body.download.base64), (value) => value.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: body.download.type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = body.download.name;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return body.value as T;
}

async function selectFile(accept: string): Promise<{ name: string; base64: string } | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(undefined);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      resolve({ name: file.name, base64: btoa(binary) });
    };
    input.click();
  });
}

function confirmMutation(message: string): boolean {
  return window.confirm(message);
}

export function createWebPulseRNClient(): PulseRNDesktopApi {
  connectLive();
  return {
    getSnapshot: () => call('getSnapshot'),
    onSnapshot: (listener) => subscribe('snapshot', listener as (value: never) => void),
    onDevices: (listener) => subscribe('devices', listener as (value: never) => void),
    getNativeLogStatuses: () => call('getNativeLogStatuses'),
    onNativeLogStatuses: (listener) => subscribe('native-logs', listener as (value: never) => void),
    queryEvents: (input = {}) => call('queryEvents', [input]),
    getEvent: (id) => call('getEvent', [id]),
    listSavedFilters: () => call('listSavedFilters'),
    saveEventFilter: (name, query, id) => call('saveEventFilter', [name, query, id]),
    deleteSavedFilter: (id) => call('deleteSavedFilter', [id]),
    listBookmarks: (sessionId) => call('listBookmarks', [sessionId]),
    addBookmark: (eventId, label) => call('addBookmark', [eventId, label]),
    deleteBookmark: (id) => call('deleteBookmark', [id]),
    listAnnotations: (eventId, sessionId) => call('listAnnotations', [eventId, sessionId]),
    saveAnnotation: (eventId, body, id) => call('saveAnnotation', [eventId, body, id]),
    deleteAnnotation: (id) => call('deleteAnnotation', [id]),
    getNetworkCurl: (eventId) => call('getNetworkCurl', [eventId]),
    exportNetworkHar: (sessionId) => call('exportNetworkHar', [sessionId]),
    listSessions: () => call('listSessions'),
    renameSession: (sessionId, displayName) => call('renameSession', [sessionId, displayName]),
    deleteSession: (sessionId) =>
      confirmMutation('Permanently delete this stored session and all of its events?')
        ? call('deleteSession', [sessionId])
        : Promise.reject(new Error('Session deletion cancelled.')),
    listStoredDevices: () => call('listStoredDevices'),
    getRetentionState: () => call('getRetentionState'),
    exportSessions: (sessionIds) => call('exportSessions', [sessionIds]),
    importSessions: async () => {
      const file = await selectFile('.pulsern');
      return file ? call('importSessionsData', [file]) : { canceled: true, sessions: 0, events: 0 };
    },
    runDatabaseMaintenance: () => call('runDatabaseMaintenance'),
    clearStoredEvents: () =>
      confirmMutation('Delete every event stored by PulseRN? This cannot be undone.')
        ? call('clearStoredEvents')
        : Promise.reject(new Error('Event deletion cancelled.')),
    requestStorage: (input) => {
      const mutation = ['set', 'delete', 'restore'].includes(input.operation);
      if (mutation && !confirmMutation(`Confirm ${input.operation} for "${input.key ?? ''}"?`)) {
        return Promise.reject(new Error('Storage mutation cancelled.'));
      }
      return call('requestStorage', [input]);
    },
    listStorageAudit: () => call('listStorageAudit'),
    createStorageSnapshot: (input) => call('createStorageSnapshot', [input]),
    listStorageSnapshots: (providerId, key) => call('listStorageSnapshots', [providerId, key]),
    deleteStorageSnapshot: (id) => call('deleteStorageSnapshot', [id]),
    exportStorageValues: (items) => call('exportStorageValues', [items]),
    getSettings: () => call('getSettings'),
    updateSettings: (patch) => call('updateSettings', [patch]),
    onSettings: (listener) => subscribe('settings', listener as (value: never) => void),
    getAppearance: () => call('getAppearance'),
    updateAppearanceSelection: (patch) => call('updateAppearanceSelection', [patch]),
    saveTheme: (theme) => call('saveTheme', [theme]),
    duplicateTheme: (id) => call('duplicateTheme', [id]),
    deleteTheme: (id) => call('deleteTheme', [id]),
    importTheme: async () => {
      const file = await selectFile('.json');
      return file ? call('importThemeData', [file]) : call('getAppearance');
    },
    exportTheme: (id) => call('exportTheme', [id]),
    importFont: async () => {
      const file = await selectFile('.ttf,.otf,.woff,.woff2');
      return file ? call('importFontData', [file]) : call('getAppearance');
    },
    registerSystemFont: (font) => call('registerSystemFont', [font]),
    deleteFont: (id) => call('deleteFont', [id]),
    loadFont: async (id) => Uint8Array.from(await call<number[]>('loadFont', [id])),
    onAppearance: (listener) => subscribe('appearance', listener as (value: never) => void),
    getMcpInfo: () => call('getMcpInfo'),
    onMcpInfo: (listener) => subscribe('mcp', listener as (value: never) => void),
    getConnectionInfo: () => call('getConnectionInfo'),
    beginPairing: () => call('beginPairing'),
    revokeTrustedDevice: (appId, deviceId) =>
      confirmMutation('Revoke this trusted device?')
        ? call('revokeTrustedDevice', [appId, deviceId])
        : call('getConnectionInfo'),
    installTlsCertificate: async () => {
      const certificate = await selectFile('.pem,.crt,.cer');
      const key = certificate ? await selectFile('.pem,.key') : undefined;
      return certificate && key
        ? call('installTlsCertificateData', [certificate, key])
        : call('getConnectionInfo');
    },
    disableTls: () =>
      confirmMutation('Disable TLS and use plaintext WebSockets?')
        ? call('disableTls')
        : call('getConnectionInfo'),
    onConnectionInfo: (listener) => subscribe('connection', listener as (value: never) => void),
    getUpdateState: () => call('getUpdateState'),
    checkForUpdates: () => call('getUpdateState'),
    downloadUpdate: () => call('getUpdateState'),
    installUpdate: () => call('getUpdateState'),
    onUpdateState: (listener) => subscribe('update', listener as (value: never) => void),
    getDebuggerState: () => call('getDebuggerState'),
    onDebuggerState: (listener) => subscribe('debugger', listener as (value: never) => void),
    discoverDebuggerTargets: () => call('discoverDebuggerTargets'),
    connectDebugger: (targetId) => call('connectDebugger', [targetId]),
    disconnectDebugger: () => call('disconnectDebugger'),
    getDebuggerSource: (sourceId) => call('getDebuggerSource', [sourceId]),
    searchDebuggerSources: (query, limit) => call('searchDebuggerSources', [query, limit]),
    getDebuggerSourceContext: (sourceId, line, contextLines) =>
      call('getDebuggerSourceContext', [sourceId, line, contextLines]),
    addDebuggerBreakpoint: (input) => call('addDebuggerBreakpoint', [input]),
    removeDebuggerBreakpoint: (id) => call('removeDebuggerBreakpoint', [id]),
    removeTemporaryDebuggerBreakpoints: () => call('removeTemporaryDebuggerBreakpoints'),
    setDebuggerBreakpointEnabled: (id, enabled) =>
      call('setDebuggerBreakpointEnabled', [id, enabled]),
    debuggerCommand: (command) => call('debuggerCommand', [command]),
    selectDebuggerCallFrame: (id) => call('selectDebuggerCallFrame', [id]),
    getDebuggerScope: (objectId) => call('getDebuggerScope', [objectId]),
    getDebuggerProperties: (objectId) => call('getDebuggerProperties', [objectId]),
    addDebuggerWatch: (expression) => call('addDebuggerWatch', [expression]),
    removeDebuggerWatch: (id) => call('removeDebuggerWatch', [id]),
    evaluateDebuggerExpression: (expression, options) =>
      call('evaluateDebuggerExpression', [expression, options]),
    releaseDebuggerObject: (objectId) => call('releaseDebuggerObject', [objectId]),
    getReactComponentSnapshot: () => call('getReactComponentSnapshot'),
    interactWithReactComponent: (action, componentId) =>
      call('interactWithReactComponent', [action, componentId]),
    setPauseOnExceptions: (mode) => call('setPauseOnExceptions', [mode]),
    setDebuggerBlackboxInternal: (enabled) => call('setDebuggerBlackboxInternal', [enabled]),
  };
}
