import { createId } from '@pulse-rn/shared';
import {
  decodeJson,
  negotiateProtocolVersion,
  parseClientMessage,
  type DevToolEventEnvelope,
} from '@pulse-rn/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ConnectedDevice } from './session-manager.js';

interface Callbacks {
  onConnected(device: ConnectedDevice): void;
  onDisconnected(connectionId: string): void;
  onEvents(events: DevToolEventEnvelope[]): void;
  onInvalidMessage(error: string): void;
}

export class DevToolWebSocketServer {
  private server?: WebSocketServer;

  constructor(
    private readonly port: number,
    private readonly callbacks: Callbacks,
    private readonly host = '127.0.0.1',
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({
        host: this.host,
        port: this.port,
        maxPayload: 2 * 1024 * 1024,
        perMessageDeflate: false,
      });
      this.server = server;
      server.once('listening', () => resolve());
      server.once('error', reject);
      server.on('connection', (socket) => this.handleConnection(socket));
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      for (const client of this.server.clients) client.close(1001, 'Server shutting down');
      this.server.close(() => resolve());
    });
  }

  private handleConnection(socket: WebSocket): void {
    const connectionId = createId('connection');
    let negotiated = false;
    const handshakeTimeout = setTimeout(() => socket.close(1008, 'Handshake timeout'), 5_000);

    socket.on('message', (data, isBinary) => {
      if (isBinary) return socket.close(1003, 'Binary messages are not supported');
      try {
        const result = parseClientMessage(decodeJson(data.toString()));
        if (!result.success) {
          this.callbacks.onInvalidMessage(result.error.message);
          return;
        }
        const message = result.data;
        if (!negotiated) {
          if (message.kind !== 'client-hello') return socket.close(1008, 'Handshake required');
          const protocolVersion = negotiateProtocolVersion(message.supportedProtocolVersions);
          if (!protocolVersion) {
            socket.send(
              JSON.stringify({
                kind: 'server-hello',
                accepted: false,
                reason: 'No compatible protocol version',
                serverTime: Date.now(),
              }),
            );
            return socket.close(1002, 'Unsupported protocol');
          }
          negotiated = true;
          clearTimeout(handshakeTimeout);
          this.callbacks.onConnected({
            connectionId,
            deviceId: message.deviceId,
            sessionId: message.sessionId,
            appId: message.appId,
            connectedAt: Date.now(),
            device: message.device,
          });
          socket.send(
            JSON.stringify({
              kind: 'server-hello',
              accepted: true,
              protocolVersion,
              connectionId,
              serverTime: Date.now(),
            }),
          );
          return;
        }
        if (message.kind === 'event-batch') this.callbacks.onEvents(message.events);
      } catch (error) {
        this.callbacks.onInvalidMessage(error instanceof Error ? error.message : 'Invalid JSON');
      }
    });
    socket.once('close', () => {
      clearTimeout(handshakeTimeout);
      if (negotiated) this.callbacks.onDisconnected(connectionId);
    });
  }
}
