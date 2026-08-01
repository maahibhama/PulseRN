import { createId } from '@pulse-rn/shared';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type Server as HttpsServer } from 'node:https';
import type { IncomingMessage } from 'node:http';
import {
  decodeJson,
  negotiateProtocolVersion,
  parseClientMessage,
  type ClientHealth,
  type ClientHello,
  type DevToolEventEnvelope,
  type StorageCommand,
  type StorageOperation,
  type StorageResult,
} from '@pulse-rn/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ConnectedDevice, DisconnectInfo } from './session-manager.js';

interface Callbacks {
  onConnected(device: ConnectedDevice): void;
  onDisconnected(connectionId: string, info: DisconnectInfo): void;
  onEvents(events: DevToolEventEnvelope[]): void;
  onHealth(connectionId: string, health: ClientHealth): void;
  onInvalidMessage(error: string): void;
}

export type ConnectionAuthentication =
  | {
      accepted: true;
      trustStatus: 'paired' | 'trusted' | 'legacy';
      reconnectToken?: string;
    }
  | { accepted: false; reason: string };

export function validateWebSocketRequest(
  request: IncomingMessage,
  port: number,
): string | undefined {
  const host = request.headers.host;
  if (!host) return 'Missing Host header';
  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return 'Malformed Host header';
  }
  const requestedPort = Number(hostUrl.port || 80);
  if (port !== 0 && requestedPort !== port) return 'Unexpected Host port';
  const origin = request.headers.origin;
  if (!origin) return undefined;
  try {
    const originUrl = new URL(origin);
    if (!['http:', 'https:'].includes(originUrl.protocol)) return 'Unsupported Origin';
    if (originUrl.hostname !== hostUrl.hostname) return 'Origin host does not match request host';
  } catch {
    return 'Malformed Origin header';
  }
  return undefined;
}

export function accessTokensMatch(expected: string, received?: string): boolean {
  if (!received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
  );
}

export class DevToolWebSocketServer {
  private server?: WebSocketServer;
  private httpsServer?: HttpsServer;
  private readonly sockets = new Map<string, WebSocket>();
  private readonly socketDevices = new Map<string, { appId: string; deviceId: string }>();
  private readonly lastHealthAt = new Map<string, number>();
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
    private readonly authToken?: string | ((hello: ClientHello) => ConnectionAuthentication),
    private readonly tls?: { cert: Buffer; key: Buffer },
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const httpsServer = this.tls ? createServer(this.tls) : undefined;
      this.httpsServer = httpsServer;
      const server = new WebSocketServer({
        ...(httpsServer ? { server: httpsServer } : { host: this.host, port: this.port }),
        maxPayload: 2 * 1024 * 1024,
        perMessageDeflate: false,
      });
      this.server = server;
      const listeningServer = httpsServer ?? server;
      listeningServer.once('listening', () => resolve());
      listeningServer.once('error', reject);
      server.on('connection', (socket, request) => this.handleConnection(socket, request));
      if (httpsServer) httpsServer.listen(this.port, this.host);
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      for (const client of this.server.clients) client.close(1001, 'Server shutting down');
      this.server.close(() => {
        if (!this.httpsServer) return resolve();
        this.httpsServer.close(() => resolve());
      });
    });
  }

  address(): { address: string; port: number } {
    const address = this.httpsServer?.address() ?? this.server?.address();
    if (!address || typeof address === 'string') {
      throw new Error('PulseRN WebSocket server is not listening.');
    }
    return { address: address.address, port: address.port };
  }

  disconnectDevice(appId: string, deviceId: string): void {
    for (const [connectionId, identity] of this.socketDevices) {
      if (identity.appId !== appId || identity.deviceId !== deviceId) continue;
      this.sockets.get(connectionId)?.close(1008, 'Device trust revoked');
    }
  }

  requestStorage(
    connectionId: string,
    input: {
      providerId: string;
      operation: StorageOperation;
      key?: string;
      value?: string;
      cursor?: string;
      limit?: number;
      backupId?: string;
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
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.backupId === undefined ? {} : { backupId: input.backupId }),
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

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const connectionId = createId('connection');
    let negotiated = false;
    const validationError = validateWebSocketRequest(request, this.address().port);
    if (validationError) {
      this.callbacks.onInvalidMessage(validationError);
      socket.close(1008, 'Request origin rejected');
      return;
    }
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
          const authentication: ConnectionAuthentication =
            typeof this.authToken === 'function'
              ? this.authToken(message)
              : this.authToken
                ? accessTokensMatch(this.authToken, message.authToken)
                  ? { accepted: true, trustStatus: 'legacy' }
                  : { accepted: false, reason: 'Authentication failed' }
                : { accepted: true, trustStatus: 'legacy' };
          if (!authentication.accepted) {
            socket.send(
              JSON.stringify({
                kind: 'server-hello',
                accepted: false,
                reason: authentication.reason,
                serverTime: Date.now(),
              }),
            );
            return socket.close(1008, 'Authentication failed');
          }
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
          this.socketDevices.set(connectionId, {
            appId: message.appId,
            deviceId: message.deviceId,
          });
          clearTimeout(handshakeTimeout);
          this.callbacks.onConnected({
            connectionId,
            deviceId: message.deviceId,
            sessionId: message.sessionId,
            appId: message.appId,
            protocolVersion,
            trustStatus:
              typeof this.authToken === 'function'
                ? authentication.trustStatus
                : this.authToken
                  ? 'legacy'
                  : 'loopback',
            remoteAddress: request.socket.remoteAddress,
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
              capabilities: ['client-health'],
              trustStatus:
                typeof this.authToken === 'function' ? authentication.trustStatus : 'loopback',
              ...(authentication.reconnectToken
                ? { reconnectToken: authentication.reconnectToken }
                : {}),
            }),
          );
          return;
        }
        if (message.kind === 'event-batch') this.callbacks.onEvents(message.events);
        if (message.kind === 'client-health') {
          const now = Date.now();
          const lastHealthAt = this.lastHealthAt.get(connectionId) ?? 0;
          if (now - lastHealthAt >= 250) {
            this.lastHealthAt.set(connectionId, now);
            this.callbacks.onHealth(connectionId, message);
          }
        }
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
    socket.once('close', (code, reason) => {
      clearTimeout(handshakeTimeout);
      this.sockets.delete(connectionId);
      this.socketDevices.delete(connectionId);
      this.lastHealthAt.delete(connectionId);
      for (const [requestId, pending] of this.pendingStorage) {
        if (pending.connectionId !== connectionId) continue;
        clearTimeout(pending.timer);
        pending.reject(new Error('Device disconnected during storage request.'));
        this.pendingStorage.delete(requestId);
      }
      if (negotiated) {
        this.callbacks.onDisconnected(connectionId, {
          code,
          reason: reason.toString() || 'Connection closed',
          disconnectedAt: Date.now(),
        });
      }
    });
  }
}
