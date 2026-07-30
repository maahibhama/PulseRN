import type { DesktopSnapshot } from '../main/session-manager.js';
import type { StorageOperation, StorageResult } from '@pulse-rn/protocol';

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
  launchAtLogin: boolean;
  keepRunningInBackground: boolean;
}

export interface PulseRNDesktopApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  onSnapshot(listener: (snapshot: DesktopSnapshot) => void): () => void;
  requestStorage(input: StorageRequestInput): Promise<StorageResult>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  onSettings(listener: (settings: AppSettings) => void): () => void;
}
