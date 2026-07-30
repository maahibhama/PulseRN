import type { DevToolEventEnvelope } from '@pulse-rn/protocol';
import { create } from 'zustand';
import type { ConnectedDevice, DesktopSnapshot } from '../../main/session-manager.js';

interface DesktopState extends DesktopSnapshot {
  selectedEventId?: string;
  setSnapshot(snapshot: DesktopSnapshot): void;
  selectEvent(id: string): void;
}

export const useDesktopStore = create<DesktopState>((set) => ({
  devices: [],
  events: [],
  setSnapshot: (snapshot) => set(snapshot),
  selectEvent: (selectedEventId) => set({ selectedEventId }),
}));

export function findSelectedEvent(events: DevToolEventEnvelope[], selectedEventId?: string) {
  return events.find((event) => event.id === selectedEventId);
}

export function deviceLabel(device: ConnectedDevice): string {
  return `${device.device.name} · ${device.device.appName}`;
}
