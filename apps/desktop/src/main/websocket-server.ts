import { createId } from '@pulse-rn/shared';
import {
  decodeJson,
  negotiateProtocolVersion,
  parseClientMessage,
  type DevToolEventEnvelope,
  type StorageCommand,
  type StorageOperation,
  type StorageResult,
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
  private readonly sockets = new Map<string, WebSocket>();
  private readonly pendingStorage = new Map<
    string,
    {
      connectionId: string;
      resolve(value: StorageResult): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

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

  requestStorage(
    connectionId: string,
    input: {
      providerId: string;
      operation: StorageOperation;
      key?: string;
      value?: string;
    },
  ): Promise<StorageResult> {
    const socket = this.sockets.get(connectionId);
    if (!socket || socket.readyState !== socket.OPEN) {
      return Promise.reject(new Error('The selected device is no longer connected.'));
    }
    const requestId = createId('storage');
    const command: StorageCommand = {
      kind: 'storage-command',
      requestId,
      providerId: input.providerId,
      operation: input.operation,
      ...(input.key === undefined ? {} : { key: input.key }),
      ...(input.value === undefined ? {} : { value: input.value }),
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingStorage.delete(requestId);
        reject(new Error('Storage request timed out.'));
      }, 10_000);
      this.pendingStorage.set(requestId, { connectionId, resolve, reject, timer });
      socket.send(JSON.stringify(command));
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
          this.sockets.set(connectionId, socket);
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
        if (message.kind === 'storage-result') {
          const pending = this.pendingStorage.get(message.requestId);
          if (pending?.connectionId === connectionId) {
            clearTimeout(pending.timer);
            this.pendingStorage.delete(message.requestId);
            pending.resolve(message);
          }
        }
      } catch (error) {
        this.callbacks.onInvalidMessage(error instanceof Error ? error.message : 'Invalid JSON');
      }
    });
    socket.once('close', () => {
      clearTimeout(handshakeTimeout);
      this.sockets.delete(connectionId);
      for (const [requestId, pending] of this.pendingStorage) {
        if (pending.connectionId !== connectionId) continue;
        clearTimeout(pending.timer);
        pending.reject(new Error('Device disconnected during storage request.'));
        this.pendingStorage.delete(requestId);
      }
      if (negotiated) this.callbacks.onDisconnected(connectionId);
    });
  }
}
