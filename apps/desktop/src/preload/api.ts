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
  backupId?: string;
}

export interface StorageAuditRecord {
  id: string;
  connectionId: string;
  providerId: string;
  key: string;
  operation: 'set' | 'delete' | 'restore';
  success: boolean;
  createdAt: number;
  backupId?: string;
  error?: string;
}

export interface StorageSnapshotRecord {
  id: string;
  connectionId: string;
  providerId: string;
  key: string;
  value: string;
  valueType: 'string' | 'number' | 'boolean' | 'json' | 'binary' | 'unknown';
  valueSize: number;
  createdAt: number;
}

export interface StorageExportResult {
  canceled: boolean;
  filePath?: string;
  exported: number;
  excluded: number;
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
  consoleCaptureLimit: number;
  networkBodyCaptureBytes: number;
  diagnosticsIntervalMs: number;
  redactionFields: string[];
  performanceFpsThreshold: number;
  performanceStallThresholdMs: number;
  performanceScreenThresholdMs: number;
  performanceNetworkThresholdMs: number;
  performanceMemoryGrowthMb: number;
  pairingCodeLifetimeMinutes: number;
  pairingRetryLimit: number;
  updateChannel: 'stable' | 'beta';
  motion: 'system' | 'reduced' | 'full';
  onboardingDismissed: boolean;
  checkForUpdatesAutomatically: boolean;
  launchAtLogin: boolean;
  keepRunningInBackground: boolean;
  mcpEnabled: boolean;
}

export interface McpInfo {
  enabled: boolean;
  available: boolean;
  command: string;
  args: string[];
  env: {
    ELECTRON_RUN_AS_NODE: '1';
  };
  clients: {
    name: string;
    connectedAt: number;
    lastSeenAt: number;
    requestCount: number;
  }[];
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
  group?: string;
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
  hitCondition?: number;
  logMessage?: string;
  hitCount?: number;
  verified: boolean;
  error?: string;
}

export interface DebuggerRemoteValue {
  type: string;
  description: string;
  value?: unknown;
  objectId?: string;
  preview?: {
    overflow: boolean;
    properties: { name: string; type: string; value?: string }[];
  };
}

export interface DebuggerProperty {
  name: string;
  value: DebuggerRemoteValue;
  enumerable?: boolean;
  writable?: boolean;
  accessor?: boolean;
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

export interface DebuggerEvaluation {
  id: string;
  expression: string;
  createdAt: number;
  frameId?: string;
  result?: DebuggerRemoteValue;
  error?: string;
}

export interface ReactComponentNode {
  id: string;
  parentId?: string;
  ownerId?: string;
  name: string;
  key?: string;
  kind: 'function' | 'class' | 'host' | 'memo' | 'forwardRef' | 'context' | 'suspense' | 'other';
  depth: number;
  source?: DebuggerLocation;
  props: Record<string, string>;
  state: Record<string, string>;
  hooks: { index: number; value: string }[];
  context: Record<string, string>;
  renderDuration?: number;
  renderCount?: number;
  changed: ('props' | 'state' | 'hooks')[];
  nativeTag?: number;
  style?: Record<string, string>;
  accessibility?: {
    label?: string;
    role?: string;
    hint?: string;
    disabled?: boolean;
  };
  children: string[];
}

export interface ReactComponentSnapshot {
  available: boolean;
  rendererCount: number;
  roots: string[];
  nodes: ReactComponentNode[];
  truncated: boolean;
  capturedAt: number;
  capabilities: {
    highlight: boolean;
    pick: boolean;
  };
  selectedId?: string;
  error?: string;
}

export interface ReactComponentInteraction {
  supported: boolean;
  active: boolean;
  selectedId?: string;
  error?: string;
}

export interface DebuggerState {
  status:
    | 'disconnected'
    | 'discovering'
    | 'connecting'
    | 'reconnecting'
    | 'connected'
    | 'paused'
    | 'error';
  targets: DebuggerTarget[];
  activeTargetId?: string;
  sources: DebuggerSource[];
  breakpoints: DebuggerBreakpoint[];
  callFrames: DebuggerCallFrame[];
  selectedCallFrameId?: string;
  watches: DebuggerWatch[];
  pauseOnExceptions: 'none' | 'uncaught' | 'all';
  blackboxInternal: boolean;
  capabilities: {
    asyncStacks: boolean;
    pauseOnExceptions: boolean;
    blackboxing: boolean;
    logpoints: boolean;
  };
  pauseReason?: string;
  error?: string;
}

export interface AddBreakpointInput extends DebuggerLocation {
  condition?: string;
  hitCondition?: number;
  logMessage?: string;
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
  listStorageAudit(): Promise<StorageAuditRecord[]>;
  createStorageSnapshot(input: {
    connectionId: string;
    providerId: string;
    key: string;
  }): Promise<StorageSnapshotRecord>;
  listStorageSnapshots(providerId?: string, key?: string): Promise<StorageSnapshotRecord[]>;
  deleteStorageSnapshot(id: string): Promise<boolean>;
  exportStorageValues(
    items: { connectionId: string; providerId: string; key: string }[],
  ): Promise<StorageExportResult>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  onSettings(listener: (settings: AppSettings) => void): () => void;
  getMcpInfo(): Promise<McpInfo>;
  onMcpInfo(listener: (info: McpInfo) => void): () => void;
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
  getDebuggerProperties(objectId: string): Promise<DebuggerProperty[]>;
  addDebuggerWatch(expression: string): Promise<DebuggerState>;
  removeDebuggerWatch(id: string): Promise<DebuggerState>;
  evaluateDebuggerExpression(
    expression: string,
    options?: { frameId?: string; allowRunning?: boolean },
  ): Promise<DebuggerRemoteValue>;
  releaseDebuggerObject(objectId: string): Promise<boolean>;
  getReactComponentSnapshot(): Promise<ReactComponentSnapshot>;
  interactWithReactComponent(
    action: 'highlight' | 'hideHighlight' | 'startPicking' | 'stopPicking' | 'pollPicked',
    componentId?: string,
  ): Promise<ReactComponentInteraction>;
  setPauseOnExceptions(mode: 'none' | 'uncaught' | 'all'): Promise<DebuggerState>;
  setDebuggerBlackboxInternal(enabled: boolean): Promise<DebuggerState>;
}
