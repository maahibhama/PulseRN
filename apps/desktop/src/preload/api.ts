import type { DesktopSnapshot } from '../main/session-manager.js';
import type { StorageOperation, StorageResult } from '@pulse-rn/protocol';

export interface StorageRequestInput {
  connectionId: string;
  providerId: string;
  operation: StorageOperation;
  key?: string;
  value?: string;
}

export interface PulseRNDesktopApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  onSnapshot(listener: (snapshot: DesktopSnapshot) => void): () => void;
  requestStorage(input: StorageRequestInput): Promise<StorageResult>;
}
