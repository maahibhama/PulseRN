import type { ClientHealth, DeviceInfo, DevToolEventEnvelope } from '@pulse-rn/protocol';

export interface ConnectionHealth extends ClientHealth {
  receivedAt: number;
}

export interface ConnectedDevice {
  connectionId: string;
  deviceId: string;
  sessionId: string;
  appId: string;
  protocolVersion?: string;
  trustStatus?: 'loopback' | 'paired' | 'trusted' | 'legacy';
  remoteAddress?: string;
  connectedAt: number;
  device: DeviceInfo;
  health?: ConnectionHealth;
}

export interface DisconnectInfo {
  code: number;
  reason: string;
  disconnectedAt: number;
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

  disconnect(connectionId: string): ConnectedDevice | undefined {
    const device = this.devices.get(connectionId);
    this.devices.delete(connectionId);
    return device;
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
