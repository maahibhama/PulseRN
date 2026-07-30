import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';
import { storageOperationSchema, storageResultSchema } from '@pulse-rn/protocol';
import type { PulseRNDesktopApi } from './api.js';

const SNAPSHOT_CHANNEL = 'pulse-rn:snapshot';
const STORAGE_CHANNEL = 'pulse-rn:storage';
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
};

contextBridge.exposeInMainWorld('pulseRN', api);
