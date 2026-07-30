import type { DesktopSnapshot } from '../main/session-manager.js';

export interface PulseRNDesktopApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  onSnapshot(listener: (snapshot: DesktopSnapshot) => void): () => void;
}
