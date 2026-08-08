import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import {
  PROTOCOL_VERSION,
  type DevToolEventEnvelope,
  type NativeLogPayload,
} from '@pulse-rn/protocol';
import type { ConnectedDevice } from './session-manager.js';

const execFile = promisify(execFileCallback);
const MAX_LINE_LENGTH = 100_000;
const MAX_EVENTS_PER_MINUTE = 12_000;
const RETRY_MS = 2_000;

export interface NativeLogCaptureStatus {
  connectionId: string;
  platform: 'ios' | 'android';
  state: 'starting' | 'capturing' | 'waiting' | 'error';
  targetId?: string;
  pid?: number;
  process?: string;
  droppedLogs: number;
  message?: string;
}

interface Capture {
  device: ConnectedDevice;
  child?: ChildProcess;
  retry?: ReturnType<typeof setTimeout>;
  stopped: boolean;
  sequence: number;
  buffer: string;
  iosParser: IosJsonStreamParser;
  recent: number[];
  dropped: number;
}

export class IosJsonStreamParser {
  private object = '';
  private depth = 0;
  private inString = false;
  private escaped = false;

  push(chunk: string): string[] {
    const objects: string[] = [];
    for (const character of chunk) {
      if (this.depth === 0) {
        if (character !== '{') continue;
        this.depth = 1;
        this.object = character;
        continue;
      }
      this.object += character;
      if (this.escaped) {
        this.escaped = false;
        continue;
      }
      if (this.inString && character === '\\') {
        this.escaped = true;
        continue;
      }
      if (character === '"') {
        this.inString = !this.inString;
        continue;
      }
      if (this.inString) continue;
      if (character === '{') this.depth += 1;
      if (character === '}') this.depth -= 1;
      if (this.depth === 0) {
        objects.push(this.object);
        this.object = '';
      }
    }
    return objects;
  }
}

function boundedMessage(value: string): { message: string; truncated?: true } {
  if (value.length <= MAX_LINE_LENGTH) return { message: value };
  return { message: value.slice(0, MAX_LINE_LENGTH), truncated: true };
}

function androidLevel(priority: string): NativeLogPayload['level'] {
  return (
    (
      {
        V: 'verbose',
        D: 'debug',
        I: 'info',
        W: 'warn',
        E: 'error',
        F: 'fatal',
        A: 'fatal',
      } as const
    )[priority] ?? 'info'
  );
}

export function parseAndroidLogLine(
  line: string,
  pid: number,
  process: string,
): NativeLogPayload | undefined {
  const match = line.match(
    /^\s*(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d+)\s+\d+\s+\d+\s+([VDIWEFA])\s+([^:]*):\s?(.*)$/,
  );
  if (!match) return undefined;
  const now = new Date();
  const loggedAt = new Date(
    now.getFullYear(),
    Number(match[1]) - 1,
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]!.slice(0, 3).padEnd(3, '0')),
  ).getTime();
  return {
    platform: 'android',
    level: androidLevel(match[7]!),
    ...boundedMessage(match[9]!),
    loggedAt,
    pid,
    process,
    ...(match[8]!.trim() ? { tag: match[8]!.trim() } : {}),
  };
}

export function parseIosLogLine(
  line: string,
  pid: number,
  process: string,
): NativeLogPayload | undefined {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const rawMessage = record['eventMessage'] ?? record['message'];
  if (typeof rawMessage !== 'string') return undefined;
  const rawLevel = String(record['messageType'] ?? record['level'] ?? 'info').toLowerCase();
  const level: NativeLogPayload['level'] = rawLevel.includes('fault')
    ? 'fatal'
    : rawLevel.includes('error')
      ? 'error'
      : rawLevel.includes('debug')
        ? 'debug'
        : rawLevel.includes('default') || rawLevel.includes('notice')
          ? 'info'
          : rawLevel.includes('info')
            ? 'info'
            : 'verbose';
  const timestamp = Date.parse(String(record['timestamp'] ?? ''));
  return {
    platform: 'ios',
    level,
    ...boundedMessage(rawMessage),
    loggedAt: Number.isFinite(timestamp) ? timestamp : Date.now(),
    pid,
    process,
    ...(typeof record['subsystem'] === 'string' ? { subsystem: record['subsystem'] } : {}),
    ...(typeof record['category'] === 'string' ? { category: record['category'] } : {}),
  };
}

export class NativeLogManager {
  private readonly captures = new Map<string, Capture>();
  private readonly statuses = new Map<string, NativeLogCaptureStatus>();

  constructor(
    private readonly onEvents: (events: DevToolEventEnvelope[]) => void,
    private readonly onStatus: (statuses: NativeLogCaptureStatus[]) => void,
  ) {}

  snapshot(): NativeLogCaptureStatus[] {
    return [...this.statuses.values()];
  }

  start(device: ConnectedDevice): void {
    if (device.device.platform !== 'ios' && device.device.platform !== 'android') return;
    this.stop(device.connectionId);
    const capture: Capture = {
      device,
      stopped: false,
      sequence: 0,
      buffer: '',
      iosParser: new IosJsonStreamParser(),
      recent: [],
      dropped: 0,
    };
    this.captures.set(device.connectionId, capture);
    this.setStatus(capture, 'starting', 'Resolving virtual device and app process…');
    void this.attach(capture);
  }

  stop(connectionId: string): void {
    const capture = this.captures.get(connectionId);
    if (capture) {
      capture.stopped = true;
      if (capture.retry) clearTimeout(capture.retry);
      capture.child?.kill();
      this.captures.delete(connectionId);
    }
    if (this.statuses.delete(connectionId)) this.publishStatus();
  }

  close(): void {
    for (const connectionId of [...this.captures.keys()]) this.stop(connectionId);
  }

  private async attach(capture: Capture): Promise<void> {
    try {
      const platform = capture.device.device.platform as 'ios' | 'android';
      const targetId = await this.resolveTarget(platform, capture.device.device.nativeTargetId);
      this.setStatus(capture, 'starting', 'Resolving app process…', targetId);
      const { pid, process } = await this.resolveProcess(platform, targetId, capture.device.appId);
      if (capture.stopped) return;
      const command = platform === 'android' ? 'adb' : 'xcrun';
      const args =
        platform === 'android'
          ? ['-s', targetId, 'logcat', '-v', 'threadtime', `--pid=${pid}`]
          : [
              'simctl',
              'spawn',
              targetId,
              'log',
              'stream',
              '--style',
              'json',
              '--level',
              'debug',
              '--predicate',
              `processIdentifier == ${pid}`,
            ];
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      capture.child = child;
      this.setStatus(capture, 'capturing', undefined, targetId, pid, process);
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => this.consume(capture, chunk, pid, process));
      child.once('error', (error) => this.schedule(capture, this.toolError(platform, error)));
      child.once('exit', () => this.schedule(capture, 'App process stopped; waiting to reattach…'));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        const platform = capture.device.device.platform as 'ios' | 'android';
        this.setStatus(
          capture,
          'error',
          `${platform === 'android' ? 'adb' : 'xcrun'} was not found. Install the required platform developer tools.`,
        );
        return;
      }
      this.schedule(capture, error instanceof Error ? error.message : String(error));
    }
  }

  private consume(capture: Capture, chunk: string, pid: number, process: string): void {
    let records: string[];
    if (capture.device.device.platform === 'ios') {
      records = capture.iosParser.push(chunk);
    } else {
      capture.buffer += chunk;
      records = capture.buffer.split(/\r?\n/);
      capture.buffer = records.pop() ?? '';
    }
    const now = Date.now();
    capture.recent = capture.recent.filter((value) => now - value < 60_000);
    const events: DevToolEventEnvelope[] = [];
    for (const record of records) {
      if (!record.trim()) continue;
      if (capture.recent.length >= MAX_EVENTS_PER_MINUTE) {
        capture.dropped += 1;
        continue;
      }
      const payload =
        capture.device.device.platform === 'android'
          ? parseAndroidLogLine(record, pid, process)
          : parseIosLogLine(record, pid, process);
      if (!payload) continue;
      capture.recent.push(now);
      events.push({
        id: `native-${randomUUID()}`,
        protocolVersion: PROTOCOL_VERSION,
        sessionId: capture.device.sessionId,
        deviceId: capture.device.deviceId,
        appId: capture.device.appId,
        timestamp: payload.loggedAt,
        sequence: capture.sequence++,
        category: 'native-log',
        type: `native-log.${payload.platform}.${payload.level}`,
        payload,
      });
    }
    if (events.length) this.onEvents(events);
    if (capture.dropped) this.setStatus(capture, 'capturing', undefined, undefined, pid, process);
  }

  private schedule(capture: Capture, message: string): void {
    if (capture.stopped || capture.retry) return;
    capture.child = undefined;
    this.setStatus(capture, 'waiting', message);
    capture.retry = setTimeout(() => {
      capture.retry = undefined;
      void this.attach(capture);
    }, RETRY_MS);
  }

  private async resolveTarget(platform: 'ios' | 'android', configured?: string): Promise<string> {
    if (configured) return configured;
    if (platform === 'android') {
      const { stdout } = await execFile('adb', ['devices']);
      const targets = stdout
        .split(/\r?\n/)
        .map((line) => line.match(/^(emulator-\d+)\s+device$/)?.[1])
        .filter((value): value is string => Boolean(value));
      if (targets.length !== 1)
        throw new Error(
          targets.length
            ? 'Multiple Android emulators are running; configure device.nativeTargetId.'
            : 'No Android emulator is running.',
        );
      return targets[0]!;
    }
    const { stdout } = await execFile('xcrun', ['simctl', 'list', 'devices', 'booted', '--json']);
    const parsed = JSON.parse(stdout) as {
      devices?: Record<string, { udid: string; state: string }[]>;
    };
    const targets = Object.values(parsed.devices ?? {})
      .flat()
      .filter((device) => device.state === 'Booted')
      .map((device) => device.udid);
    if (targets.length !== 1)
      throw new Error(
        targets.length
          ? 'Multiple iOS Simulators are booted; configure device.nativeTargetId.'
          : 'No iOS Simulator is booted.',
      );
    return targets[0]!;
  }

  private async resolveProcess(
    platform: 'ios' | 'android',
    targetId: string,
    appId: string,
  ): Promise<{ pid: number; process: string }> {
    if (platform === 'android') {
      const { stdout } = await execFile('adb', ['-s', targetId, 'shell', 'pidof', '-s', appId]);
      const pid = Number(stdout.trim());
      if (!Number.isInteger(pid) || pid <= 0)
        throw new Error(`Android app ${appId} is not running on ${targetId}.`);
      return { pid, process: appId };
    }
    const { stdout } = await execFile('xcrun', ['simctl', 'spawn', targetId, 'launchctl', 'list']);
    const row = stdout.split(/\r?\n/).find((line) => line.includes(appId));
    const pid = Number(row?.trim().split(/\s+/)[0]);
    if (!Number.isInteger(pid) || pid <= 0)
      throw new Error(`iOS app ${appId} is not running on ${targetId}.`);
    return { pid, process: appId };
  }

  private toolError(platform: 'ios' | 'android', error: Error): string {
    return error.message.includes('ENOENT')
      ? `${platform === 'android' ? 'adb' : 'xcrun'} was not found. Install the required platform developer tools.`
      : error.message;
  }

  private setStatus(
    capture: Capture,
    state: NativeLogCaptureStatus['state'],
    message?: string,
    targetId?: string,
    pid?: number,
    process?: string,
  ): void {
    const previous = this.statuses.get(capture.device.connectionId);
    this.statuses.set(capture.device.connectionId, {
      connectionId: capture.device.connectionId,
      platform: capture.device.device.platform as 'ios' | 'android',
      state,
      targetId: targetId ?? previous?.targetId ?? capture.device.device.nativeTargetId,
      pid: pid ?? previous?.pid,
      process: process ?? previous?.process,
      droppedLogs: capture.dropped,
      ...(message ? { message } : {}),
    });
    this.publishStatus();
  }

  private publishStatus(): void {
    this.onStatus(this.snapshot());
  }
}
