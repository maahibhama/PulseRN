import type { DevToolEventEnvelope } from '@pulse-rn/protocol';
import { create } from 'zustand';
import type { ConnectedDevice, DesktopSnapshot } from '../../main/session-manager.js';
import type { AppSettings } from '../../preload/api.js';

interface DesktopState extends DesktopSnapshot {
  selectedEventId?: string;
  settings: AppSettings;
  setSnapshot(snapshot: DesktopSnapshot): void;
  setSettings(settings: AppSettings): void;
  selectEvent(id: string): void;
}

export const useDesktopStore = create<DesktopState>((set) => ({
  devices: [],
  events: [],
  settings: {
    theme: 'system',
    density: 'comfortable',
    timelineOrder: 'newest',
    launchAtLogin: false,
    keepRunningInBackground: true,
  },
  setSnapshot: (snapshot) => set(snapshot),
  setSettings: (settings) => set({ settings }),
  selectEvent: (selectedEventId) => set({ selectedEventId }),
}));

export function findSelectedEvent(events: DevToolEventEnvelope[], selectedEventId?: string) {
  return events.find((event) => event.id === selectedEventId);
}

export function deviceLabel(device: ConnectedDevice): string {
  return `${device.device.name} · ${device.device.appName}`;
}
