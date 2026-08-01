import type { ConnectedDevice, DesktopSnapshot } from '../main/session-manager.js';
import type {
  DevToolEventCategory,
  DevToolEventEnvelope,
  StorageOperation,
  StorageResult,
} from '@pulse-rn/protocol';

export interface EventCursor {
  timestamp: number;
  sequence: number;
  id: string;
}

export interface EventQuery {
  category?: DevToolEventCategory;
  categories?: DevToolEventCategory[];
  cursor?: EventCursor;
  deviceId?: string;
  limit?: number;
  order?: 'newest' | 'oldest';
  sessionId?: string;
}

export interface EventPage {
  events: DevToolEventEnvelope[];
  hasMore: boolean;
  nextCursor?: EventCursor;
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
}

export interface DatabaseMaintenanceReport {
  integrity: 'ok' | 'recovered';
  removedExpired: number;
  removedOverflow: number;
  removedInvalid: number;
  retainedEvents: number;
  completedAt: number;
}

export interface SessionArchiveResult {
  canceled: boolean;
  filePath?: string;
  sessions: number;
  events: number;
}

export interface StorageRequestInput {
  connectionId: string;
  providerId: string;
  operation: StorageOperation;
  key?: string;
  value?: string;
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
  launchAtLogin: boolean;
  keepRunningInBackground: boolean;
}

export interface ConnectionInfo {
  mode: 'loopback' | 'lan';
  port: number;
  requiresAuth: boolean;
  addresses: string[];
  accessToken?: string;
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
  listSessions(): Promise<StoredSession[]>;
  exportSessions(sessionIds?: string[]): Promise<SessionArchiveResult>;
  importSessions(): Promise<SessionArchiveResult>;
  runDatabaseMaintenance(): Promise<DatabaseMaintenanceReport>;
  clearStoredEvents(): Promise<DatabaseMaintenanceReport>;
  requestStorage(input: StorageRequestInput): Promise<StorageResult>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  onSettings(listener: (settings: AppSettings) => void): () => void;
  getConnectionInfo(): Promise<ConnectionInfo>;
  revealConnectionToken(): Promise<ConnectionInfo>;
  rotateConnectionToken(): Promise<ConnectionInfo>;
  installTlsCertificate(): Promise<ConnectionInfo>;
  disableTls(): Promise<ConnectionInfo>;
  onConnectionInfo(listener: (info: ConnectionInfo) => void): () => void;
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
