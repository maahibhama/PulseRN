import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';
import { storageOperationSchema, storageResultSchema } from '@pulse-rn/protocol';
import type { AppSettings, PulseRNDesktopApi } from './api.js';

const SNAPSHOT_CHANNEL = 'pulse-rn:snapshot';
const STORAGE_CHANNEL = 'pulse-rn:storage';
const SETTINGS_CHANNEL = 'pulse-rn:settings';
const snapshotSchema = z.object({
  devices: z.array(z.unknown()),
  events: z.array(z.unknown()),
});
const storageRequestSchema = z.object({
  connectionId: z.string().trim().min(1).max(256),
  providerId: z.string().trim().min(1).max(256),
  operation: storageOperationSchema,
  key: z.string().max(10_000).optional(),
  value: z.string().max(1_000_000).optional(),
});
const settingsSchema = z.object({
  theme: z.enum(['system', 'dark', 'light']),
  density: z.enum(['comfortable', 'compact']),
  timelineOrder: z.enum(['newest', 'oldest']),
  launchAtLogin: z.boolean(),
  keepRunningInBackground: z.boolean(),
});
const settingsPatchSchema = settingsSchema.partial().strict();

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
};

contextBridge.exposeInMainWorld('pulseRN', api);
