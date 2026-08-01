import type { ConnectedDevice, DesktopSnapshot } from '../main/session-manager.js';
import type {
  DevToolEventCategory,
  DevToolEventEnvelope,
  StorageOperation,
  StorageResult,
} from '@pulse-rn/protocol';
import type { DesktopUpdateState } from '../update-types.js';
export type { DesktopUpdateState } from '../update-types.js';

export interface EventCursor {
  timestamp: number;
  sequence: number;
  id: string;
}

export interface EventQuery {
  category?: DevToolEventCategory;
  categories?: DevToolEventCategory[];
  cursor?: EventCursor;
  direction?: 'forward' | 'backward';
  deviceId?: string;
  endTime?: number;
  errorsOnly?: boolean;
  correlationId?: string;
  limit?: number;
  order?: 'newest' | 'oldest';
  parentId?: string;
  sessionId?: string;
  startTime?: number;
  text?: string;
  type?: string;
  types?: string[];
}

export interface EventPage {
  events: DevToolEventEnvelope[];
  hasMore: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  nextCursor?: EventCursor;
  previousCursor?: EventCursor;
  total: number;
}

export interface StoredSession {
  sessionId: string;
  appId: string;
  deviceId: string;
  appName: string;
  deviceName: string;
  platform: string;
  startedAt: number;
  lastSeenAt: number;
  eventCount: number;
  appVersion?: string;
  sdkVersion?: string;
  protocolVersion?: string;
  endedAt?: number;
  connectionCount: number;
  displayName?: string;
  trustStatus?: string;
  disconnectCode?: number;
  disconnectReason?: string;
}

export interface StoredDevice {
  deviceId: string;
  appId: string;
  name: string;
  appName: string;
  platform: string;
  platformVersion?: string;
  model?: string;
  appVersion?: string;
  sdkVersion: string;
  firstSeenAt: number;
  lastSeenAt: number;
  sessionCount: number;
}

export interface StoredRetentionState {
  maxAgeDays: number;
  maxEvents: number;
  lastRunAt: number;
}

export interface SavedEventFilter {
  id: string;
  name: string;
  query: Omit<EventQuery, 'cursor' | 'direction' | 'limit'>;
  createdAt: number;
  updatedAt: number;
}

export interface EventBookmark {
  id: string;
  eventId: string;
  sessionId: string;
  label?: string;
  createdAt: number;
}

export interface EventAnnotation {
  id: string;
  eventId: string;
  sessionId: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface DatabaseRecoveryReport {
  status: 'not-needed' | 'recovered';
  backupPath?: string;
  recoveredEvents: number;
  recoveredSessions: number;
  lostEvents: number;
  lossesUnknown: boolean;
  reason?: string;
}

export interface DatabaseMaintenanceReport {
  integrity: 'ok' | 'recovered';
  removedExpired: number;
  removedOverflow: number;
  removedInvalid: number;
  retainedEvents: number;
  completedAt: number;
  recovery?: DatabaseRecoveryReport;
}

export interface SessionArchiveResult {
  canceled: boolean;
  filePath?: string;
  sessions: number;
  events: number;
}

export interface NetworkExportResult {
  canceled: boolean;
  filePath?: string;
  entries: number;
}

export interface StorageRequestInput {
  connectionId: string;
  providerId: string;
  operation: StorageOperation;
  key?: string;
  value?: string;
  cursor?: string;
  limit?: number;
}

export interface AppSettings {
  theme: 'system' | 'dark' | 'light';
  density: 'comfortable' | 'compact';
  timelineOrder: 'newest' | 'oldest';
  metroPort: number;
  devToolPort: number;
  allowLanConnections: boolean;
  tlsEnabled: boolean;
  eventRetentionDays: number;
  maxStoredEvents: number;
  checkForUpdatesAutomatically: boolean;
  launchAtLogin: boolean;
  keepRunningInBackground: boolean;
}

export interface ConnectionInfo {
  mode: 'loopback' | 'lan';
  port: number;
  requiresAuth: boolean;
  addresses: string[];
  pairing?: {
    code: string;
    expiresAt: number;
    remainingAttempts: number;
  };
  trustedDevices: {
    appId: string;
    deviceId: string;
    appName: string;
    deviceName: string;
    createdAt: number;
    lastUsedAt: number;
    revokedAt?: number;
    status: 'trusted' | 'revoked';
  }[];
  tls: {
    enabled: boolean;
    configured: boolean;
    fingerprint256?: string;
    subject?: string;
    issuer?: string;
    validFrom?: string;
    validTo?: string;
  };
}

export interface DebuggerTarget {
  id: string;
  title: string;
  description: string;
  appId?: string;
  deviceName?: string;
}

export interface DebuggerSource {
  id: string;
  url: string;
  name: string;
  internal: boolean;
  original: boolean;
}

export interface DebuggerLocation {
  sourceId: string;
  line: number;
  column: number;
}

export interface DebuggerBreakpoint extends DebuggerLocation {
  id: string;
  appId?: string;
  enabled: boolean;
  condition?: string;
  verified: boolean;
  error?: string;
}

export interface DebuggerRemoteValue {
  type: string;
  description: string;
  value?: unknown;
  objectId?: string;
}

export interface DebuggerProperty {
  name: string;
  value: DebuggerRemoteValue;
}

export interface DebuggerScope {
  type: string;
  name?: string;
  objectId?: string;
}

export interface DebuggerCallFrame {
  id: string;
  functionName: string;
  location: DebuggerLocation;
  scopes: DebuggerScope[];
}

export interface DebuggerWatch {
  id: string;
  expression: string;
  result?: DebuggerRemoteValue;
  error?: string;
}

export interface DebuggerState {
  status: 'disconnected' | 'discovering' | 'connecting' | 'connected' | 'paused' | 'error';
  targets: DebuggerTarget[];
  activeTargetId?: string;
  sources: DebuggerSource[];
  breakpoints: DebuggerBreakpoint[];
  callFrames: DebuggerCallFrame[];
  selectedCallFrameId?: string;
  watches: DebuggerWatch[];
  pauseOnExceptions: 'none' | 'uncaught' | 'all';
  pauseReason?: string;
  error?: string;
}

export interface AddBreakpointInput extends DebuggerLocation {
  condition?: string;
}

export interface PulseRNDesktopApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  onSnapshot(listener: (snapshot: DesktopSnapshot) => void): () => void;
  onDevices(listener: (devices: ConnectedDevice[]) => void): () => void;
  queryEvents(input?: EventQuery): Promise<EventPage>;
  getEvent(id: string): Promise<EventPage['events'][number] | undefined>;
  listSavedFilters(): Promise<SavedEventFilter[]>;
  saveEventFilter(
    name: string,
    query: Omit<EventQuery, 'cursor' | 'direction' | 'limit'>,
    id?: string,
  ): Promise<SavedEventFilter>;
  deleteSavedFilter(id: string): Promise<boolean>;
  listBookmarks(sessionId?: string): Promise<EventBookmark[]>;
  addBookmark(eventId: string, label?: string): Promise<EventBookmark>;
  deleteBookmark(id: string): Promise<boolean>;
  listAnnotations(eventId?: string, sessionId?: string): Promise<EventAnnotation[]>;
  saveAnnotation(eventId: string, body: string, id?: string): Promise<EventAnnotation>;
  deleteAnnotation(id: string): Promise<boolean>;
  getNetworkCurl(eventId: string): Promise<string>;
  exportNetworkHar(sessionId?: string): Promise<NetworkExportResult>;
  listSessions(): Promise<StoredSession[]>;
  renameSession(sessionId: string, displayName: string): Promise<StoredSession>;
  deleteSession(sessionId: string): Promise<{ sessions: number; events: number }>;
  listStoredDevices(): Promise<StoredDevice[]>;
  getRetentionState(): Promise<StoredRetentionState | undefined>;
  exportSessions(sessionIds?: string[]): Promise<SessionArchiveResult>;
  importSessions(): Promise<SessionArchiveResult>;
  runDatabaseMaintenance(): Promise<DatabaseMaintenanceReport>;
  clearStoredEvents(): Promise<DatabaseMaintenanceReport>;
  requestStorage(input: StorageRequestInput): Promise<StorageResult>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  onSettings(listener: (settings: AppSettings) => void): () => void;
  getConnectionInfo(): Promise<ConnectionInfo>;
  beginPairing(): Promise<ConnectionInfo>;
  revokeTrustedDevice(appId: string, deviceId: string): Promise<ConnectionInfo>;
  installTlsCertificate(): Promise<ConnectionInfo>;
  disableTls(): Promise<ConnectionInfo>;
  onConnectionInfo(listener: (info: ConnectionInfo) => void): () => void;
  getUpdateState(): Promise<DesktopUpdateState>;
  checkForUpdates(): Promise<DesktopUpdateState>;
  downloadUpdate(): Promise<DesktopUpdateState>;
  installUpdate(): Promise<DesktopUpdateState>;
  onUpdateState(listener: (state: DesktopUpdateState) => void): () => void;
  getDebuggerState(): Promise<DebuggerState>;
  onDebuggerState(listener: (state: DebuggerState) => void): () => void;
  discoverDebuggerTargets(): Promise<DebuggerState>;
  connectDebugger(targetId: string): Promise<DebuggerState>;
  disconnectDebugger(): Promise<DebuggerState>;
  getDebuggerSource(sourceId: string): Promise<string>;
  addDebuggerBreakpoint(input: AddBreakpointInput): Promise<DebuggerState>;
  removeDebuggerBreakpoint(id: string): Promise<DebuggerState>;
  setDebuggerBreakpointEnabled(id: string, enabled: boolean): Promise<DebuggerState>;
  debuggerCommand(
    command: 'pause' | 'resume' | 'stepOver' | 'stepInto' | 'stepOut',
  ): Promise<DebuggerState>;
  selectDebuggerCallFrame(id: string): Promise<DebuggerState>;
  getDebuggerScope(objectId: string): Promise<DebuggerProperty[]>;
  addDebuggerWatch(expression: string): Promise<DebuggerState>;
  removeDebuggerWatch(id: string): Promise<DebuggerState>;
  evaluateDebuggerExpression(expression: string): Promise<DebuggerRemoteValue>;
  setPauseOnExceptions(mode: 'none' | 'uncaught' | 'all'): Promise<DebuggerState>;
}
