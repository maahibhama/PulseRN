import type { DeviceInfo, DevToolEventEnvelope } from '@pulse-rn/protocol';

export interface ConnectedDevice {
  connectionId: string;
  deviceId: string;
  sessionId: string;
  appId: string;
  connectedAt: number;
  device: DeviceInfo;
}

export interface DesktopSnapshot {
  devices: ConnectedDevice[];
  events: DevToolEventEnvelope[];
}

export class SessionManager {
  private readonly devices = new Map<string, ConnectedDevice>();
  private events: DevToolEventEnvelope[] = [];

  connect(device: ConnectedDevice): void {
    this.devices.set(device.connectionId, device);
  }

  disconnect(connectionId: string): void {
    this.devices.delete(connectionId);
  }

  append(events: readonly DevToolEventEnvelope[]): void {
    this.events = [...this.events, ...events].slice(-2_000);
  }

  hydrate(events: readonly DevToolEventEnvelope[]): void {
    this.events = [...events].slice(-2_000);
  }

  snapshot(): DesktopSnapshot {
    return {
      devices: [...this.devices.values()],
      events: [...this.events],
    };
  }
}
