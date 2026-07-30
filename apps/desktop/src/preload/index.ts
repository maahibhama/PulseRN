import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';
import type { PulseRNDesktopApi } from './api.js';

const SNAPSHOT_CHANNEL = 'pulse-rn:snapshot';
const snapshotSchema = z.object({
  devices: z.array(z.unknown()),
  events: z.array(z.unknown()),
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
};

contextBridge.exposeInMainWorld('pulseRN', api);
