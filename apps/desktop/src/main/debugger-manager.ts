import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import {
  LEAST_UPPER_BOUND,
  TraceMap,
  generatedPositionFor,
  originalPositionFor,
  type SourceMapInput,
} from '@jridgewell/trace-mapping';
import WebSocket from 'ws';
import { z } from 'zod';
import type {
  AddBreakpointInput,
  DebuggerBreakpoint,
  DebuggerCallFrame,
  DebuggerLocation,
  DebuggerProperty,
  DebuggerRemoteValue,
  DebuggerSource,
  DebuggerState,
  DebuggerTarget,
  DebuggerWatch,
} from '../preload/api.js';

const targetSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string().optional().default('Hermes runtime'),
    description: z.string().optional().default('React Native'),
    webSocketDebuggerUrl: z.string().url(),
    appId: z.string().optional(),
    deviceName: z.string().optional(),
  })
  .passthrough();
const cdpMessageSchema = z
  .object({
    id: z.number().int().optional(),
    method: z.string().optional(),
    result: z.unknown().optional(),
    error: z.object({ message: z.string() }).passthrough().optional(),
    params: z.unknown().optional(),
  })
  .passthrough();
const scriptParsedSchema = z.object({
  scriptId: z.string(),
  url: z.string(),
  sourceMapURL: z.string().optional(),
});
const pausedSchema = z.object({
  reason: z.string(),
  hitBreakpoints: z.array(z.string()).optional().default([]),
  callFrames: z.array(
    z.object({
      callFrameId: z.string(),
      functionName: z.string(),
      location: z.object({
        scriptId: z.string(),
        lineNumber: z.number().int().nonnegative(),
        columnNumber: z.number().int().nonnegative().optional().default(0),
      }),
      scopeChain: z.array(
        z.object({
          type: z.string(),
          name: z.string().optional(),
          object: z.object({ objectId: z.string().optional() }).passthrough(),
        }),
      ),
    }),
  ),
});
const breakpointResolvedSchema = z.object({
  breakpointId: z.string(),
  location: z.object({
    scriptId: z.string(),
    lineNumber: z.number().int().nonnegative(),
    columnNumber: z.number().int().nonnegative().optional().default(0),
  }),
});
const storedBreakpointSchema = z.object({
  id: z.string().uuid(),
  appId: z.string().optional(),
  sourceId: z.string().min(1).max(100_000),
  line: z.number().int().min(1).max(10_000_000),
  column: z.number().int().min(1).max(10_000_000),
  enabled: z.boolean(),
  condition: z.string().max(10_000).optional(),
  hitCondition: z.number().int().positive().max(1_000_000).optional(),
  logMessage: z.string().max(10_000).optional(),
  hitCount: z.number().int().nonnegative().default(0),
  verified: z.boolean().default(false),
  error: z.string().optional(),
});
const storedWatchSchema = z.object({
  id: z.string().uuid(),
  expression: z.string().trim().min(1).max(10_000),
});

interface CdpScript {
  scriptId: string;
  url: string;
  sourceMapURL?: string;
}

interface SourceMapRecord {
  scriptId: string;
  map: TraceMap;
  sources: string[];
  contents: Map<string, string>;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

interface StoredDebuggerData {
  breakpoints: DebuggerBreakpoint[];
  watches: DebuggerWatch[];
  pauseOnExceptions: DebuggerState['pauseOnExceptions'];
  blackboxInternal: boolean;
}

const emptyData: StoredDebuggerData = {
  breakpoints: [],
  watches: [],
  pauseOnExceptions: 'none',
  blackboxInternal: true,
};
const MAX_DEBUGGER_PAYLOAD_BYTES = 50 * 1024 * 1024;

function isLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

function sourceName(url: string): string {
  const withoutQuery = url.split('?')[0] ?? url;
  return basename(withoutQuery) || url || 'anonymous';
}

function sourceGroup(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts.slice(0, -1).join('/') || parsed.host || 'Application';
  } catch {
    const parts = url.split(/[\\/]/).filter(Boolean);
    return parts.slice(0, -1).join('/') || 'Application';
  }
}

function isInternalSource(url: string): boolean {
  return (
    !url ||
    url.startsWith('native ') ||
    url.includes('/node_modules/') ||
    url.includes('__prelude__') ||
    url.startsWith('hermes')
  );
}

function remoteValue(value: unknown): DebuggerRemoteValue {
  const parsed = z
    .object({
      type: z.string(),
      subtype: z.string().optional(),
      description: z.string().optional(),
      value: z.unknown().optional(),
      unserializableValue: z.string().optional(),
      objectId: z.string().optional(),
    })
    .passthrough()
    .parse(value);
  return {
    type: parsed.subtype ?? parsed.type,
    description:
      parsed.description ??
      parsed.unserializableValue ??
      (parsed.value === undefined ? parsed.type : JSON.stringify(parsed.value)),
    ...(parsed.value === undefined ? {} : { value: parsed.value }),
    ...(parsed.objectId ? { objectId: parsed.objectId } : {}),
  };
}

export class DebuggerManager {
  private socket?: WebSocket;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly targetUrls = new Map<string, string>();
  private readonly scripts = new Map<string, CdpScript>();
  private readonly sourceMaps = new Map<string, SourceMapRecord>();
  private readonly sourceToMap = new Map<string, SourceMapRecord>();
  private readonly generatedSources = new Map<string, DebuggerSource>();
  private readonly cdpBreakpointIds = new Map<string, string>();
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;
  private manuallyDisconnected = true;
  private data: StoredDebuggerData;
  private state: DebuggerState;

  constructor(
    private readonly filePath: string,
    private readonly getMetroPort: () => number,
    private readonly onState: (state: DebuggerState) => void,
  ) {
    this.data = this.readData();
    this.state = {
      status: 'disconnected',
      targets: [],
      sources: [],
      breakpoints: this.data.breakpoints,
      callFrames: [],
      watches: this.data.watches,
      pauseOnExceptions: this.data.pauseOnExceptions,
      blackboxInternal: this.data.blackboxInternal,
      capabilities: {
        asyncStacks: false,
        pauseOnExceptions: false,
        blackboxing: false,
        logpoints: false,
      },
    };
  }

  snapshot(): DebuggerState {
    return structuredClone(this.state);
  }

  async discover(): Promise<DebuggerState> {
    this.patch({ status: 'discovering', error: undefined });
    const base = `http://127.0.0.1:${this.getMetroPort()}`;
    try {
      let response = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) {
        response = await fetch(`${base}/json`, { signal: AbortSignal.timeout(5_000) });
      }
      if (!response.ok) throw new Error(`Metro returned HTTP ${response.status}.`);
      const values = z.array(z.unknown()).parse(await response.json());
      this.targetUrls.clear();
      const targets: DebuggerTarget[] = [];
      for (const value of values) {
        const parsed = targetSchema.safeParse(value);
        if (!parsed.success) continue;
        const socketUrl = new URL(parsed.data.webSocketDebuggerUrl);
        if (!isLoopback(socketUrl.hostname) || !['ws:', 'wss:'].includes(socketUrl.protocol)) {
          continue;
        }
        this.targetUrls.set(parsed.data.id, socketUrl.toString());
        targets.push({
          id: parsed.data.id,
          title: parsed.data.title,
          description: parsed.data.description,
          appId: parsed.data.appId,
          deviceName: parsed.data.deviceName,
        });
      }
      this.patch({ status: this.socket ? this.state.status : 'disconnected', targets });
    } catch (error) {
      this.patch({
        status: 'error',
        error: `Could not discover Hermes targets on Metro port ${this.getMetroPort()}: ${String(
          error instanceof Error ? error.message : error,
        )}`,
      });
    }
    return this.snapshot();
  }

  async connect(targetId: string): Promise<DebuggerState> {
    const socketUrl = this.targetUrls.get(targetId);
    if (!socketUrl) throw new Error('Refresh Metro targets and select a valid Hermes runtime.');
    await this.disconnect();
    this.manuallyDisconnected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.patch({
      status: 'connecting',
      activeTargetId: targetId,
      error: undefined,
      sources: [],
      callFrames: [],
      selectedCallFrameId: undefined,
    });
    await new Promise<void>((resolve, reject) => {
      const debuggerUrl = new URL(socketUrl);
      const origin = `${debuggerUrl.protocol === 'wss:' ? 'https:' : 'http:'}//${debuggerUrl.host}`;
      const socket = new WebSocket(socketUrl, {
        maxPayload: MAX_DEBUGGER_PAYLOAD_BYTES,
        origin,
      });
      this.socket = socket;
      const fail = (error: Error) => {
        reject(error);
        this.failConnection(error);
      };
      socket.once('open', resolve);
      socket.once('error', fail);
      socket.on('message', (message) => this.handleMessage(message.toString()));
      socket.on('close', () => {
        if (this.socket === socket) {
          this.socket = undefined;
          this.rejectPending(new Error('Hermes debugger connection closed.'));
          if (this.manuallyDisconnected) {
            this.patch({
              status: 'disconnected',
              callFrames: [],
              selectedCallFrameId: undefined,
              pauseReason: undefined,
              error: undefined,
            });
          } else {
            this.scheduleReconnect(targetId);
          }
        }
      });
    });
    try {
      await this.send('Runtime.enable');
      await this.send('Debugger.enable');
      const capabilities = {
        asyncStacks: await this.supports('Debugger.setAsyncCallStackDepth', { maxDepth: 32 }),
        pauseOnExceptions: await this.applyPauseMode(),
        blackboxing: await this.applyBlackboxing(),
        logpoints: true,
      };
      this.reconnectAttempt = 0;
      this.patch({
        status: this.state.status === 'paused' ? 'paused' : 'connected',
        error: undefined,
        capabilities,
      });
    } catch (error) {
      this.failConnection(error instanceof Error ? error : new Error(String(error)));
    }
    return this.snapshot();
  }

  async disconnect(): Promise<DebuggerState> {
    this.manuallyDisconnected = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.removeAllListeners();
      socket.close();
    }
    this.rejectPending(new Error('Debugger disconnected.'));
    this.scripts.clear();
    this.sourceMaps.clear();
    this.sourceToMap.clear();
    this.generatedSources.clear();
    this.cdpBreakpointIds.clear();
    for (const breakpoint of this.data.breakpoints) {
      breakpoint.verified = false;
      breakpoint.error = undefined;
    }
    this.patch({
      status: 'disconnected',
      activeTargetId: undefined,
      sources: [],
      callFrames: [],
      selectedCallFrameId: undefined,
      pauseReason: undefined,
      error: undefined,
      capabilities: {
        asyncStacks: false,
        pauseOnExceptions: false,
        blackboxing: false,
        logpoints: false,
      },
    });
    return this.snapshot();
  }

  async getSource(sourceId: string): Promise<string> {
    const mapRecord = this.sourceToMap.get(sourceId);
    if (mapRecord) {
      const embedded = mapRecord.contents.get(sourceId);
      if (embedded !== undefined) return embedded;
      const sourceUrl = new URL(sourceId);
      if (!isLoopback(sourceUrl.hostname) || !['http:', 'https:'].includes(sourceUrl.protocol)) {
        throw new Error('Original source host is not loopback.');
      }
      return this.fetchBoundedText(sourceUrl, 'Original source');
    }
    const script = this.scripts.get(sourceId);
    if (!script) throw new Error('Source is no longer available.');
    const result = z
      .object({ scriptSource: z.string().max(MAX_DEBUGGER_PAYLOAD_BYTES) })
      .parse(await this.send('Debugger.getScriptSource', { scriptId: script.scriptId }));
    return result.scriptSource;
  }

  async addBreakpoint(input: AddBreakpointInput): Promise<DebuggerState> {
    const breakpoint: DebuggerBreakpoint = {
      id: crypto.randomUUID(),
      appId: this.activeAppId(),
      sourceId: input.sourceId,
      line: input.line,
      column: input.column,
      condition: input.condition?.trim() || undefined,
      hitCondition: input.hitCondition,
      logMessage: input.logMessage?.trim() || undefined,
      hitCount: 0,
      enabled: true,
      verified: false,
    };
    this.data.breakpoints.push(breakpoint);
    this.persist();
    await this.installBreakpoint(breakpoint);
    this.publishData();
    return this.snapshot();
  }

  async removeBreakpoint(id: string): Promise<DebuggerState> {
    const cdpId = this.cdpBreakpointIds.get(id);
    if (cdpId) {
      await this.send('Debugger.removeBreakpoint', { breakpointId: cdpId }).catch(() => undefined);
    }
    this.cdpBreakpointIds.delete(id);
    this.data.breakpoints = this.data.breakpoints.filter((entry) => entry.id !== id);
    this.persist();
    this.publishData();
    return this.snapshot();
  }

  async setBreakpointEnabled(id: string, enabled: boolean): Promise<DebuggerState> {
    const breakpoint = this.data.breakpoints.find((entry) => entry.id === id);
    if (!breakpoint) throw new Error('Breakpoint not found.');
    const cdpId = this.cdpBreakpointIds.get(id);
    if (!enabled && cdpId) {
      await this.send('Debugger.removeBreakpoint', { breakpointId: cdpId }).catch(() => undefined);
      this.cdpBreakpointIds.delete(id);
    }
    breakpoint.enabled = enabled;
    breakpoint.verified = false;
    breakpoint.error = undefined;
    if (enabled) await this.installBreakpoint(breakpoint);
    this.persist();
    this.publishData();
    return this.snapshot();
  }

  async command(command: 'pause' | 'resume' | 'stepOver' | 'stepInto' | 'stepOut') {
    const methods = {
      pause: 'Debugger.pause',
      resume: 'Debugger.resume',
      stepOver: 'Debugger.stepOver',
      stepInto: 'Debugger.stepInto',
      stepOut: 'Debugger.stepOut',
    } as const;
    await this.send(methods[command]);
    return this.snapshot();
  }

  selectCallFrame(id: string): DebuggerState {
    if (!this.state.callFrames.some((frame) => frame.id === id)) {
      throw new Error('Call frame is no longer available.');
    }
    this.patch({ selectedCallFrameId: id });
    void this.refreshWatches();
    return this.snapshot();
  }

  async getScope(objectId: string): Promise<DebuggerProperty[]> {
    const result = z
      .object({
        result: z.array(
          z.object({
            name: z.string(),
            value: z.unknown().optional(),
          }),
        ),
      })
      .parse(
        await this.send('Runtime.getProperties', {
          objectId,
          ownProperties: true,
          generatePreview: true,
        }),
      );
    return result.result
      .filter((property) => property.value !== undefined)
      .map((property) => ({ name: property.name, value: remoteValue(property.value) }));
  }

  async addWatch(expression: string): Promise<DebuggerState> {
    const trimmed = expression.trim();
    if (!trimmed) throw new Error('Watch expression cannot be empty.');
    this.data.watches.push({ id: crypto.randomUUID(), expression: trimmed });
    this.persist();
    await this.refreshWatches();
    return this.snapshot();
  }

  async removeWatch(id: string): Promise<DebuggerState> {
    this.data.watches = this.data.watches.filter((watch) => watch.id !== id);
    this.persist();
    this.publishData();
    return this.snapshot();
  }

  async evaluate(expression: string): Promise<DebuggerRemoteValue> {
    const callFrameId = this.state.selectedCallFrameId;
    if (!callFrameId || this.state.status !== 'paused') {
      throw new Error('Expressions can only be evaluated while paused.');
    }
    const result = z
      .object({
        result: z.unknown(),
        exceptionDetails: z.object({ text: z.string().optional() }).passthrough().optional(),
      })
      .parse(
        await this.send('Debugger.evaluateOnCallFrame', {
          callFrameId,
          expression,
          generatePreview: true,
          silent: true,
          objectGroup: 'pulsern-debugger',
        }),
      );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? 'Expression evaluation failed.');
    }
    return remoteValue(result.result);
  }

  async setPauseOnExceptions(mode: DebuggerState['pauseOnExceptions']): Promise<DebuggerState> {
    this.data.pauseOnExceptions = mode;
    this.persist();
    const supported = await this.applyPauseMode();
    this.patch({
      capabilities: { ...this.state.capabilities, pauseOnExceptions: supported },
    });
    this.publishData();
    return this.snapshot();
  }

  async setBlackboxInternal(enabled: boolean): Promise<DebuggerState> {
    this.data.blackboxInternal = enabled;
    this.persist();
    const supported = await this.applyBlackboxing();
    this.patch({
      blackboxInternal: enabled,
      capabilities: { ...this.state.capabilities, blackboxing: supported },
    });
    return this.snapshot();
  }

  close(): void {
    void this.disconnect();
  }

  private async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Connect to a Hermes target first.');
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket!.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }));
    });
  }

  private handleMessage(raw: string): void {
    let unknownMessage: unknown;
    try {
      unknownMessage = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = cdpMessageSchema.safeParse(unknownMessage);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    if (!message.method) return;
    if (message.method === 'Debugger.scriptParsed') {
      const script = scriptParsedSchema.safeParse(message.params);
      if (script.success) void this.addScript(script.data);
    } else if (message.method === 'Debugger.paused') {
      const pause = pausedSchema.safeParse(message.params);
      if (pause.success) this.handlePaused(pause.data);
    } else if (message.method === 'Debugger.breakpointResolved') {
      const resolved = breakpointResolvedSchema.safeParse(message.params);
      if (resolved.success) this.handleBreakpointResolved(resolved.data.breakpointId);
    } else if (message.method === 'Debugger.resumed') {
      void this.send('Runtime.releaseObjectGroup', { objectGroup: 'pulsern-debugger' }).catch(
        () => undefined,
      );
      this.patch({
        status: 'connected',
        callFrames: [],
        selectedCallFrameId: undefined,
        pauseReason: undefined,
      });
    }
  }

  private async addScript(script: CdpScript): Promise<void> {
    this.scripts.set(script.scriptId, script);
    const generated: DebuggerSource = {
      id: script.scriptId,
      url: script.url || `anonymous://${script.scriptId}`,
      name: sourceName(script.url),
      internal: isInternalSource(script.url),
      original: false,
      group: sourceGroup(script.url),
    };
    this.generatedSources.set(script.scriptId, generated);
    if (script.sourceMapURL) await this.loadSourceMap(script).catch(() => undefined);
    this.refreshSources();
    await this.restoreBreakpoints();
  }

  private async loadSourceMap(script: CdpScript): Promise<void> {
    const raw = await this.fetchSourceMap(script);
    const parsed = z
      .object({
        sources: z.array(z.string()),
        sourcesContent: z.array(z.string().nullable()).optional(),
      })
      .passthrough()
      .parse(JSON.parse(raw));
    const map = new TraceMap(JSON.parse(raw) as SourceMapInput, script.url);
    const contents = new Map<string, string>();
    map.resolvedSources.forEach((source, index) => {
      const content = parsed.sourcesContent?.[index];
      if (content !== null && content !== undefined) contents.set(source, content);
    });
    const record: SourceMapRecord = {
      scriptId: script.scriptId,
      map,
      sources: map.resolvedSources,
      contents,
    };
    this.sourceMaps.set(script.scriptId, record);
    for (const source of map.resolvedSources) this.sourceToMap.set(source, record);
  }

  private async fetchSourceMap(script: CdpScript): Promise<string> {
    const mapUrl = script.sourceMapURL!;
    if (mapUrl.startsWith('data:')) {
      if (mapUrl.length > MAX_DEBUGGER_PAYLOAD_BYTES * 1.5) {
        throw new Error('Inline source map exceeds the debugger limit.');
      }
      const comma = mapUrl.indexOf(',');
      if (comma < 0) throw new Error('Malformed inline source map.');
      const metadata = mapUrl.slice(0, comma);
      const payload = mapUrl.slice(comma + 1);
      return metadata.includes(';base64')
        ? Buffer.from(payload, 'base64').toString('utf8')
        : decodeURIComponent(payload);
    }
    const resolved = new URL(mapUrl, script.url || `http://127.0.0.1:${this.getMetroPort()}/`);
    if (!isLoopback(resolved.hostname)) throw new Error('Source map host is not loopback.');
    return this.fetchBoundedText(resolved, 'Source map');
  }

  private async fetchBoundedText(url: URL, label: string): Promise<string> {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_DEBUGGER_PAYLOAD_BYTES) {
      throw new Error(`${label} exceeds the debugger limit.`);
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_DEBUGGER_PAYLOAD_BYTES) {
      throw new Error(`${label} exceeds the debugger limit.`);
    }
    return text;
  }

  private refreshSources(): void {
    const originals: DebuggerSource[] = [];
    for (const record of this.sourceMaps.values()) {
      for (const source of record.sources) {
        originals.push({
          id: source,
          url: source,
          name: sourceName(source),
          internal: isInternalSource(source),
          original: true,
          group: sourceGroup(source),
        });
      }
    }
    const unique = new Map<string, DebuggerSource>();
    for (const source of [...originals, ...this.generatedSources.values()]) {
      if (!unique.has(source.id)) unique.set(source.id, source);
    }
    this.patch({
      sources: [...unique.values()].sort((left, right) => left.url.localeCompare(right.url)),
    });
  }

  private mapGeneratedLocation(scriptId: string, lineNumber: number, columnNumber: number) {
    const record = this.sourceMaps.get(scriptId);
    if (record) {
      const original = originalPositionFor(record.map, {
        line: lineNumber + 1,
        column: columnNumber,
      });
      if (original.source && original.line !== null) {
        return {
          sourceId: original.source,
          line: original.line,
          column: (original.column ?? 0) + 1,
        };
      }
    }
    return { sourceId: scriptId, line: lineNumber + 1, column: columnNumber + 1 };
  }

  private generatedLocation(location: DebuggerLocation) {
    const record = this.sourceToMap.get(location.sourceId);
    if (!record) {
      return {
        scriptId: location.sourceId,
        lineNumber: location.line - 1,
        columnNumber: Math.max(0, location.column - 1),
      };
    }
    const generated = generatedPositionFor(record.map, {
      source: location.sourceId,
      line: location.line,
      column: Math.max(0, location.column - 1),
      bias: LEAST_UPPER_BOUND,
    });
    if (generated.line === null) return undefined;
    return {
      scriptId: record.scriptId,
      lineNumber: generated.line - 1,
      columnNumber: generated.column ?? 0,
    };
  }

  private handlePaused(pause: z.infer<typeof pausedSchema>): void {
    let breakpointChanged = false;
    for (const cdpId of pause.hitBreakpoints) {
      const localId = [...this.cdpBreakpointIds.entries()].find(
        ([, installedId]) => installedId === cdpId,
      )?.[0];
      const breakpoint = this.data.breakpoints.find((entry) => entry.id === localId);
      if (!breakpoint) continue;
      breakpoint.hitCount = (breakpoint.hitCount ?? 0) + 1;
      breakpointChanged = true;
    }
    if (breakpointChanged) {
      this.persist();
      this.publishData();
    }
    const callFrames: DebuggerCallFrame[] = pause.callFrames.map((frame) => ({
      id: frame.callFrameId,
      functionName: frame.functionName || '(anonymous)',
      location: this.mapGeneratedLocation(
        frame.location.scriptId,
        frame.location.lineNumber,
        frame.location.columnNumber,
      ),
      scopes: frame.scopeChain.map((scope) => ({
        type: scope.type,
        name: scope.name,
        objectId: scope.object.objectId,
      })),
    }));
    this.patch({
      status: 'paused',
      pauseReason: pause.reason,
      callFrames,
      selectedCallFrameId: callFrames[0]?.id,
    });
    void this.refreshWatches();
  }

  private async installBreakpoint(breakpoint: DebuggerBreakpoint): Promise<void> {
    if (!breakpoint.enabled || !this.socket) return;
    if (this.cdpBreakpointIds.has(breakpoint.id)) return;
    if (breakpoint.appId && breakpoint.appId !== this.activeAppId()) return;
    const location = this.generatedLocation(breakpoint);
    if (!location) {
      breakpoint.verified = false;
      breakpoint.error = 'Waiting for source map.';
      return;
    }
    try {
      const script = this.scripts.get(location.scriptId);
      if (!script?.url) {
        breakpoint.verified = false;
        breakpoint.error = 'Waiting for script URL.';
        return;
      }
      const result = z
        .object({
          breakpointId: z.string(),
          locations: z.array(z.unknown()).optional().default([]),
        })
        .parse(
          await this.send('Debugger.setBreakpointByUrl', {
            url: script.url,
            lineNumber: location.lineNumber,
            columnNumber: location.columnNumber,
            condition: this.breakpointCondition(breakpoint),
          }),
        );
      breakpoint.verified = result.locations.length > 0;
      breakpoint.error = breakpoint.verified ? undefined : 'Waiting for executable code.';
      this.cdpBreakpointIds.set(breakpoint.id, result.breakpointId);
    } catch (error) {
      breakpoint.verified = false;
      breakpoint.error = error instanceof Error ? error.message : String(error);
    }
  }

  private breakpointCondition(breakpoint: DebuggerBreakpoint): string {
    const guards: string[] = [];
    if (breakpoint.condition) guards.push(`(${breakpoint.condition})`);
    if (breakpoint.hitCondition) {
      const key = JSON.stringify(breakpoint.id);
      guards.push(
        `((globalThis.__pulseRNDebuggerHits ??= {}), (globalThis.__pulseRNDebuggerHits[${key}] = (globalThis.__pulseRNDebuggerHits[${key}] ?? 0) + 1) === ${breakpoint.hitCondition})`,
      );
    }
    const guard = guards.length > 0 ? guards.join(' && ') : 'true';
    if (breakpoint.logMessage) {
      return `(() => { if (!(${guard})) return false; console.log(${JSON.stringify(
        `[PulseRN logpoint] ${breakpoint.logMessage}`,
      )}); return false; })()`;
    }
    return guards.join(' && ');
  }

  private async restoreBreakpoints(): Promise<void> {
    for (const breakpoint of this.data.breakpoints) {
      if (!breakpoint.enabled || breakpoint.verified) continue;
      await this.installBreakpoint(breakpoint);
    }
    this.persist();
    this.publishData();
  }

  private handleBreakpointResolved(cdpBreakpointId: string): void {
    const localId = [...this.cdpBreakpointIds.entries()].find(
      ([, cdpId]) => cdpId === cdpBreakpointId,
    )?.[0];
    const breakpoint = this.data.breakpoints.find((entry) => entry.id === localId);
    if (!breakpoint) return;
    breakpoint.verified = true;
    breakpoint.error = undefined;
    this.persist();
    this.publishData();
  }

  private activeAppId(): string | undefined {
    const target = this.state.targets.find((entry) => entry.id === this.state.activeTargetId);
    return target?.appId ?? target?.title;
  }

  private async refreshWatches(): Promise<void> {
    for (const watch of this.data.watches) {
      watch.result = undefined;
      watch.error = undefined;
      if (this.state.status !== 'paused') continue;
      try {
        watch.result = await this.evaluate(watch.expression);
      } catch (error) {
        watch.error = error instanceof Error ? error.message : String(error);
      }
    }
    this.publishData();
  }

  private async supports(method: string, params?: Record<string, unknown>): Promise<boolean> {
    if (!this.socket) return false;
    try {
      await this.send(method, params);
      return true;
    } catch {
      return false;
    }
  }

  private async applyPauseMode(): Promise<boolean> {
    if (!this.socket) return false;
    const state =
      this.data.pauseOnExceptions === 'none'
        ? 'none'
        : this.data.pauseOnExceptions === 'all'
          ? 'all'
          : 'uncaught';
    return this.supports('Debugger.setPauseOnExceptions', { state });
  }

  private async applyBlackboxing(): Promise<boolean> {
    if (!this.socket) return false;
    return this.supports('Debugger.setBlackboxPatterns', {
      patterns: this.data.blackboxInternal
        ? ['(?:^|/)node_modules/', '(?:^|/)react-native/', '^hermes', '__prelude__']
        : [],
    });
  }

  private patch(patch: Partial<DebuggerState>): void {
    this.state = { ...this.state, ...patch };
    this.onState(this.snapshot());
  }

  private publishData(): void {
    this.patch({
      breakpoints: structuredClone(this.data.breakpoints),
      watches: structuredClone(this.data.watches),
      pauseOnExceptions: this.data.pauseOnExceptions,
    });
  }

  private failConnection(error: Error): void {
    this.socket?.removeAllListeners();
    this.socket?.close();
    this.socket = undefined;
    this.rejectPending(error);
    const message = error.message;
    const diagnostic = /401|unauthor/i.test(message)
      ? 'Metro rejected the debugger connection with HTTP 401. Close React Native DevTools, reload the app, refresh targets, and reconnect.'
      : /409|already|another debugger|connected/i.test(message)
        ? 'Another debugger owns this Hermes runtime. Close React Native DevTools or other CDP clients, then reconnect.'
        : `${message} Close React Native DevTools if it is already attached.`;
    this.patch({
      status: 'error',
      error: diagnostic,
    });
  }

  private scheduleReconnect(targetId: string): void {
    if (this.manuallyDisconnected || this.reconnectAttempt >= 5) {
      this.patch({
        status: 'error',
        callFrames: [],
        selectedCallFrameId: undefined,
        pauseReason: undefined,
        error:
          this.reconnectAttempt >= 5
            ? 'Hermes target did not return after five reconnect attempts. Reload the app and refresh targets.'
            : undefined,
      });
      return;
    }
    this.reconnectAttempt += 1;
    this.patch({
      status: 'reconnecting',
      callFrames: [],
      selectedCallFrameId: undefined,
      pauseReason: undefined,
      error: `Hermes target reloaded. Reconnecting (${this.reconnectAttempt}/5)…`,
    });
    const delay = Math.min(4_000, 400 * 2 ** (this.reconnectAttempt - 1));
    this.reconnectTimer = setTimeout(() => {
      void this.discover().then(async () => {
        if (this.manuallyDisconnected) return;
        if (!this.targetUrls.has(targetId)) {
          this.scheduleReconnect(targetId);
          return;
        }
        await this.connect(targetId).catch(() => {
          if (!this.manuallyDisconnected) this.scheduleReconnect(targetId);
        });
      });
    }, delay);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private readData(): StoredDebuggerData {
    try {
      const parsed = z
        .object({
          breakpoints: z.array(storedBreakpointSchema).default([]),
          watches: z.array(storedWatchSchema).default([]),
          pauseOnExceptions: z.enum(['none', 'uncaught', 'all']).default('none'),
          blackboxInternal: z.boolean().default(true),
        })
        .parse(JSON.parse(readFileSync(this.filePath, 'utf8')));
      return {
        breakpoints: parsed.breakpoints.map((breakpoint) => ({
          ...breakpoint,
          verified: false,
          error: undefined,
        })),
        watches: parsed.watches,
        pauseOnExceptions: parsed.pauseOnExceptions,
        blackboxInternal: parsed.blackboxInternal,
      };
    } catch {
      return structuredClone(emptyData);
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.data, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporary, this.filePath);
  }
}
