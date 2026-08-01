import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFile, chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  PULSERN_MCP_TOOLS,
  type PulseRNAccessFile,
  type PulseRNBridgeRequest,
  type PulseRNBridgeResponse,
} from '@pulse-rn/mcp';
import { eventCategorySchema, type McpAccessMode } from '@pulse-rn/protocol';
import type { EventDatabase, EventQuery } from './database.js';
import type { DiagnosticService } from './diagnostic-service.js';
import type { DebuggerManager } from './debugger-manager.js';
import type { SessionManager } from './session-manager.js';
import type { DevToolWebSocketServer } from './websocket-server.js';

const MAX_REQUEST_BYTES = 1024 * 1024;
const identifier = z.string().trim().min(1).max(2048);
const toolNames = new Set(PULSERN_MCP_TOOLS.map((tool) => tool.name));
const requestSchema = z.object({
  id: z.string().uuid(),
  token: z.string().min(32).max(256),
  client: z.string().trim().min(1).max(128),
  tool: z.string().refine((value) => toolNames.has(value), 'Unknown MCP tool.'),
  arguments: z.record(z.unknown()),
});

export interface McpBridgeDependencies {
  database(): EventDatabase;
  debugger(): DebuggerManager;
  sessions: SessionManager;
  server(): DevToolWebSocketServer;
  diagnostics(): DiagnosticService;
  accessMode(): McpAccessMode;
}

export interface McpClientStatus {
  name: string;
  connectedAt: number;
  lastSeenAt: number;
  requestCount: number;
}

interface AuditEntry {
  timestamp: number;
  client: string;
  tool: string;
  target?: string;
  success: boolean;
  arguments: Record<string, unknown>;
  error?: string;
}

const debuggerControlTools = new Set([
  'pulsern_connect_debugger',
  'pulsern_pause',
  'pulsern_resume',
  'pulsern_step',
  'pulsern_add_breakpoint',
  'pulsern_remove_breakpoint',
  'pulsern_remove_temporary_breakpoints',
]);
const fullControlTools = new Set([
  'pulsern_evaluate',
  'pulsern_interact_with_component',
  'pulsern_set_storage',
  'pulsern_delete_storage',
]);

class McpPermissionError extends Error {}

function safeArguments(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...args };
  if ('value' in safe) safe['value'] = '[OMITTED]';
  if ('expression' in safe) safe['expression'] = '[OMITTED]';
  if ('condition' in safe) safe['condition'] = '[OMITTED]';
  if ('logMessage' in safe) safe['logMessage'] = '[OMITTED]';
  return { tool, ...safe };
}

function tokensMatch(expected: string, actual: string): boolean {
  const left = createHash('sha256').update(expected).digest();
  const right = createHash('sha256').update(actual).digest();
  return timingSafeEqual(left, right);
}

export class McpBridge {
  private listener?: Server;
  private readonly sockets = new Set<Socket>();
  private token = '';
  private readonly rateLimits = new Map<string, number[]>();
  private readonly clients = new Map<string, McpClientStatus>();

  constructor(
    private readonly userDataPath: string,
    private readonly dependencies: McpBridgeDependencies,
    private readonly onStatusChanged: () => void = () => undefined,
  ) {}

  clientSnapshot(): McpClientStatus[] {
    return [...this.clients.values()]
      .map((client) => ({ ...client }))
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt);
  }

  get accessFilePath(): string {
    return join(this.userDataPath, 'mcp-access.json');
  }

  get socketPath(): string {
    return process.platform === 'win32'
      ? '\\\\.\\pipe\\pulsern-mcp'
      : join(this.userDataPath, 'mcp.sock');
  }

  async start(): Promise<void> {
    if (this.listener) return;
    await mkdir(this.userDataPath, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') await unlink(this.socketPath).catch(() => undefined);
    this.token = randomBytes(32).toString('hex');
    const listener = createServer((socket) => this.accept(socket));
    this.listener = listener;
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(this.socketPath, () => {
        listener.off('error', reject);
        resolve();
      });
    });
    if (process.platform !== 'win32') await chmod(this.socketPath, 0o600);
    await this.writeAccessFile();
    this.onStatusChanged();
  }

  async stop(): Promise<void> {
    const listener = this.listener;
    this.listener = undefined;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (listener) await new Promise<void>((resolve) => listener.close(() => resolve()));
    await unlink(this.accessFilePath).catch(() => undefined);
    if (process.platform !== 'win32') await unlink(this.socketPath).catch(() => undefined);
    this.token = '';
    this.clients.clear();
    this.onStatusChanged();
  }

  private async writeAccessFile(): Promise<void> {
    const access: PulseRNAccessFile = {
      version: 1,
      socketPath: this.socketPath,
      token: this.token,
    };
    const temporary = `${this.accessFilePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(access, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.accessFilePath);
    await chmod(this.accessFilePath, 0o600);
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.setEncoding('utf8');
    socket.setTimeout(20_000, () => socket.destroy());
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.destroy(new Error('MCP request exceeds the size limit.'));
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = '';
      void this.handle(socket, line);
    });
    socket.once('close', () => this.sockets.delete(socket));
    socket.once('error', () => this.sockets.delete(socket));
  }

  private async handle(socket: Socket, line: string): Promise<void> {
    let request: PulseRNBridgeRequest | undefined;
    try {
      request = requestSchema.parse(JSON.parse(line));
      if (!tokensMatch(this.token, request.token)) throw new Error('MCP authentication failed.');
      this.assertAllowed(request.tool);
      this.checkRateLimit(request.client, request.tool);
      const result = await this.execute(request.tool, request.arguments);
      const now = Date.now();
      const client = this.clients.get(request.client);
      this.clients.set(request.client, {
        name: request.client,
        connectedAt: client?.connectedAt ?? now,
        lastSeenAt: now,
        requestCount: (client?.requestCount ?? 0) + 1,
      });
      this.onStatusChanged();
      await this.audit({
        timestamp: now,
        client: request.client,
        tool: request.tool,
        target:
          String(request.arguments['sessionId'] ?? request.arguments['connectionId'] ?? '') ||
          undefined,
        success: true,
        arguments: safeArguments(request.tool, request.arguments),
      });
      this.respond(socket, { id: request.id, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PulseRN MCP request failed.';
      if (request) {
        await this.audit({
          timestamp: Date.now(),
          client: request.client,
          tool: request.tool,
          success: false,
          arguments: safeArguments(request.tool, request.arguments),
          error: message.slice(0, 500),
        });
      }
      this.respond(socket, {
        id: request?.id ?? 'invalid',
        error: {
          code:
            error instanceof McpPermissionError
              ? 'PULSERN_MCP_PERMISSION_DENIED'
              : 'PULSERN_MCP_ERROR',
          message,
        },
      });
    }
  }

  private respond(socket: Socket, response: PulseRNBridgeResponse): void {
    socket.end(`${JSON.stringify(response)}\n`);
  }

  private checkRateLimit(client: string, tool: string): void {
    if (
      ![
        'pulsern_evaluate',
        'pulsern_set_storage',
        'pulsern_delete_storage',
        'pulsern_interact_with_component',
      ].includes(tool)
    )
      return;
    const key = `${client}:${tool}`;
    const now = Date.now();
    const recent = (this.rateLimits.get(key) ?? []).filter((value) => now - value < 10_000);
    if (recent.length >= 10) throw new Error('Sensitive MCP tool rate limit exceeded.');
    recent.push(now);
    this.rateLimits.set(key, recent);
  }

  private assertAllowed(tool: string): void {
    const mode = this.dependencies.accessMode();
    if (fullControlTools.has(tool) && mode !== 'full') {
      throw new McpPermissionError(`${tool} requires full MCP access. Current mode is ${mode}.`);
    }
    if (debuggerControlTools.has(tool) && mode === 'read-only') {
      throw new McpPermissionError(
        `${tool} requires debugger or full MCP access. Current mode is read-only.`,
      );
    }
  }

  private async audit(entry: AuditEntry): Promise<void> {
    const path = join(this.userDataPath, 'mcp-audit.jsonl');
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await appendFile(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  }

  private eventQuery(args: Record<string, unknown>, defaults: EventQuery = {}): EventQuery {
    return z
      .object({
        sessionId: identifier.optional(),
        deviceId: identifier.optional(),
        category: eventCategorySchema.optional(),
        type: z.string().trim().min(1).max(256).optional(),
        text: z.string().trim().min(1).max(1_000).optional(),
        correlationId: identifier.optional(),
        errorsOnly: z.boolean().optional(),
        startTime: z.number().finite().nonnegative().optional(),
        endTime: z.number().finite().nonnegative().optional(),
        order: z.enum(['newest', 'oldest']).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .strict()
      .transform((value) => ({ ...defaults, ...value }))
      .parse(args);
  }

  private async execute(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const database = this.dependencies.database();
    const debuggerManager = this.dependencies.debugger();
    switch (tool) {
      case 'pulsern_list_sessions': {
        const input = z
          .object({ limit: z.number().int().min(1).max(100).optional() })
          .strict()
          .parse(args);
        return database.listSessions(input.limit);
      }
      case 'pulsern_get_session': {
        const { sessionId } = z.object({ sessionId: identifier }).strict().parse(args);
        const session = database.listSessions(100).find((value) => value.sessionId === sessionId);
        if (!session) throw new Error('Session not found.');
        return {
          session,
          device: database.listDevices(100).find((value) => value.deviceId === session.deviceId),
        };
      }
      case 'pulsern_query_events':
        return database.query(this.eventQuery(args));
      case 'pulsern_get_event': {
        const { eventId } = z.object({ eventId: identifier }).strict().parse(args);
        const event = database.findById(eventId);
        if (!event) throw new Error('Event not found.');
        return event;
      }
      case 'pulsern_analyze_errors': {
        const input = z
          .object({
            sessionId: identifier.optional(),
            limit: z.number().int().min(1).max(100).optional(),
          })
          .strict()
          .parse(args);
        return this.dependencies.diagnostics().diagnose(input.sessionId);
      }
      case 'pulsern_diagnose_session': {
        const { sessionId } = z.object({ sessionId: identifier.optional() }).strict().parse(args);
        return this.dependencies.diagnostics().diagnose(sessionId);
      }
      case 'pulsern_create_diagnostic_snapshot': {
        const input = z
          .object({
            sessionId: identifier.optional(),
            triggerEventId: identifier.optional(),
          })
          .strict()
          .parse(args);
        const diagnosis = this.dependencies.diagnostics().diagnose(input.sessionId);
        const session = database
          .listSessions(500)
          .find((entry) => entry.sessionId === diagnosis.sessionId)!;
        if (input.triggerEventId) {
          const trigger = database.findById(input.triggerEventId);
          if (!trigger || trigger.sessionId !== diagnosis.sessionId) {
            throw new Error('The trigger event does not belong to the diagnostic session.');
          }
        }
        const evidenceIds = new Set(diagnosis.evidence.map((entry) => entry.eventId));
        if (input.triggerEventId) evidenceIds.add(input.triggerEventId);
        const events = this.dependencies
          .diagnostics()
          .eventsForDiagnosis(diagnosis.sessionId)
          .filter((event) => evidenceIds.has(event.id))
          .slice(0, 500);
        const state = debuggerManager.snapshot();
        const target = state.targets.find((entry) => entry.id === state.activeTargetId);
        const debuggerSnapshot =
          state.status === 'paused' && target?.appId === session.appId
            ? {
                targetId: target.id,
                ...(state.pauseReason ? { pauseReason: state.pauseReason } : {}),
                callFrames: state.callFrames.slice(0, 100).map((frame) => ({
                  functionName: frame.functionName,
                  sourceId: frame.location.sourceId,
                  line: frame.location.line,
                  column: frame.location.column,
                  scopes: frame.scopes.slice(0, 50).map((scope) => ({
                    type: scope.type,
                    ...(scope.name ? { name: scope.name } : {}),
                  })),
                })),
              }
            : undefined;
        return database.saveDiagnosticSnapshot({
          version: 1,
          id: randomUUID(),
          sessionId: diagnosis.sessionId,
          createdAt: Date.now(),
          ...(input.triggerEventId ? { triggerEventId: input.triggerEventId } : {}),
          diagnosis,
          events,
          ...(debuggerSnapshot ? { debugger: debuggerSnapshot } : {}),
        });
      }
      case 'pulsern_list_diagnostic_snapshots': {
        const { sessionId } = z.object({ sessionId: identifier.optional() }).strict().parse(args);
        return database.listDiagnosticSnapshots(sessionId);
      }
      case 'pulsern_get_diagnostic_snapshot': {
        const { id } = z.object({ id: z.string().uuid() }).strict().parse(args);
        const snapshot = database.getDiagnosticSnapshot(id);
        if (!snapshot) throw new Error('Diagnostic snapshot not found.');
        return snapshot;
      }
      case 'pulsern_delete_diagnostic_snapshot': {
        const { id } = z.object({ id: z.string().uuid() }).strict().parse(args);
        return database.deleteDiagnosticSnapshot(id);
      }
      case 'pulsern_inspect_network':
        return database.query(
          this.eventQuery(args, { category: 'network', order: 'newest', limit: 100 }),
        );
      case 'pulsern_inspect_redux':
        return database.query(
          this.eventQuery(args, { category: 'redux', order: 'newest', limit: 100 }),
        );
      case 'pulsern_inspect_navigation':
        return database.query(
          this.eventQuery(args, { category: 'navigation', order: 'newest', limit: 100 }),
        );
      case 'pulsern_get_performance_summary':
        return database.query(
          this.eventQuery(args, { category: 'performance', order: 'newest', limit: 200 }),
        );
      case 'pulsern_get_connection_health':
        z.object({}).strict().parse(args);
        return this.dependencies.sessions.snapshot().devices;
      case 'pulsern_discover_targets':
        z.object({}).strict().parse(args);
        return debuggerManager.discover();
      case 'pulsern_connect_debugger': {
        const { targetId } = z.object({ targetId: identifier }).strict().parse(args);
        return debuggerManager.connect(targetId);
      }
      case 'pulsern_get_debugger_state':
        z.object({}).strict().parse(args);
        return debuggerManager.snapshot();
      case 'pulsern_search_sources': {
        const input = z
          .object({
            query: z.string().trim().min(1).max(1_000),
            limit: z.number().int().min(1).max(100).optional(),
          })
          .strict()
          .parse(args);
        return debuggerManager.searchSources(input.query, input.limit);
      }
      case 'pulsern_get_source_context': {
        const input = z
          .object({
            sourceId: identifier,
            line: z.number().int().min(1).max(10_000_000),
            contextLines: z.number().int().min(1).max(50).optional(),
          })
          .strict()
          .parse(args);
        return debuggerManager.getSourceContext(input.sourceId, input.line, input.contextLines);
      }
      case 'pulsern_pause':
      case 'pulsern_resume':
        z.object({}).strict().parse(args);
        return debuggerManager.command(tool === 'pulsern_pause' ? 'pause' : 'resume');
      case 'pulsern_step': {
        const { kind } = z
          .object({ kind: z.enum(['over', 'into', 'out']) })
          .strict()
          .parse(args);
        return debuggerManager.command(
          kind === 'over' ? 'stepOver' : kind === 'into' ? 'stepInto' : 'stepOut',
        );
      }
      case 'pulsern_add_breakpoint': {
        const input = z
          .object({
            sourceId: identifier,
            line: z.number().int().min(1).max(10_000_000),
            column: z.number().int().min(1).max(10_000_000).default(1),
            condition: z.string().max(10_000).optional(),
            hitCondition: z.number().int().positive().max(1_000_000).optional(),
            logMessage: z.string().max(10_000).optional(),
            temporary: z.boolean().optional(),
          })
          .strict()
          .parse(args);
        return debuggerManager.addBreakpoint(input);
      }
      case 'pulsern_remove_breakpoint': {
        const { id } = z.object({ id: z.string().uuid() }).strict().parse(args);
        return debuggerManager.removeBreakpoint(id);
      }
      case 'pulsern_remove_temporary_breakpoints':
        z.object({}).strict().parse(args);
        return debuggerManager.removeTemporaryBreakpoints();
      case 'pulsern_get_call_frames':
        z.object({}).strict().parse(args);
        return debuggerManager.snapshot().callFrames;
      case 'pulsern_get_scope':
      case 'pulsern_get_properties': {
        const { objectId } = z.object({ objectId: identifier }).strict().parse(args);
        return tool === 'pulsern_get_scope'
          ? debuggerManager.getScope(objectId)
          : debuggerManager.getProperties(objectId);
      }
      case 'pulsern_evaluate': {
        const input = z
          .object({
            expression: z.string().trim().min(1).max(10_000),
            frameId: identifier.optional(),
            allowRunning: z.boolean().optional(),
          })
          .strict()
          .parse(args);
        return debuggerManager.evaluate(input.expression, {
          ...(input.frameId ? { frameId: input.frameId } : {}),
          ...(input.allowRunning === undefined ? {} : { allowRunning: input.allowRunning }),
        });
      }
      case 'pulsern_get_react_tree':
        z.object({}).strict().parse(args);
        return debuggerManager.getReactComponentSnapshot();
      case 'pulsern_interact_with_component': {
        const input = z
          .object({
            action: z.enum([
              'highlight',
              'hideHighlight',
              'startPicking',
              'stopPicking',
              'pollPicked',
            ]),
            componentId: z.string().min(1).max(256).optional(),
          })
          .strict()
          .parse(args);
        return debuggerManager.interactWithReactComponent(input.action, input.componentId);
      }
      case 'pulsern_list_storage_providers': {
        const { connectionId } = z.object({ connectionId: identifier }).strict().parse(args);
        return this.dependencies
          .server()
          .requestStorage(connectionId, { providerId: 'all', operation: 'providers' });
      }
      case 'pulsern_list_storage':
      case 'pulsern_get_storage':
      case 'pulsern_set_storage':
      case 'pulsern_delete_storage': {
        const input = z
          .object({
            connectionId: identifier,
            providerId: identifier,
            key: z.string().max(10_000).optional(),
            value: z.string().max(1_000_000).optional(),
            cursor: z.string().max(100).optional(),
            limit: z.number().int().min(1).max(500).optional(),
          })
          .strict()
          .parse(args);
        const operation = tool.slice('pulsern_'.length).replace('_storage', '') as
          'list' | 'get' | 'set' | 'delete';
        if (operation !== 'list' && !input.key) throw new Error('A storage key is required.');
        if (operation === 'set' && input.value === undefined)
          throw new Error('A storage value is required.');
        const result = await this.dependencies.server().requestStorage(input.connectionId, {
          providerId: input.providerId,
          operation,
          ...(input.key === undefined ? {} : { key: input.key }),
          ...(input.value === undefined ? {} : { value: input.value }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        });
        if (operation === 'set' || operation === 'delete') {
          database.recordStorageAudit({
            connectionId: input.connectionId,
            providerId: input.providerId,
            key: input.key ?? '',
            operation,
            success: result.success,
            ...(result.backupId ? { backupId: result.backupId } : {}),
            ...(result.error ? { error: result.error } : {}),
          });
        }
        return result;
      }
      default:
        throw new Error(`Unsupported PulseRN MCP tool: ${tool}`);
    }
  }
}
