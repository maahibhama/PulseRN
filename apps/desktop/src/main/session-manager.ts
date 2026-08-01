import type { ClientHealth, DeviceInfo, DevToolEventEnvelope } from '@pulse-rn/protocol';

export interface ConnectionHealth extends ClientHealth {
  receivedAt: number;
}

export interface ConnectedDevice {
  connectionId: string;
  deviceId: string;
  sessionId: string;
  appId: string;
  connectedAt: number;
  device: DeviceInfo;
  health?: ConnectionHealth;
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

  updateHealth(connectionId: string, health: ClientHealth, receivedAt = Date.now()): void {
    const device = this.devices.get(connectionId);
    if (!device) return;
    this.devices.set(connectionId, {
      ...device,
      health: {
        ...health,
        receivedAt,
      },
    });
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
