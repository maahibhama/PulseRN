import { describe, expect, it } from 'vitest';
import { IosJsonStreamParser, parseAndroidLogLine, parseIosLogLine } from './native-log-manager.js';

describe('native log parsing', () => {
  it('parses Android threadtime records', () => {
    const result = parseAndroidLogLine(
      '08-08 12:34:56.789  4321  4322 W ReactNativeJS: Bridge warning',
      4321,
      'dev.pulsern.example',
    );
    expect(result).toMatchObject({
      platform: 'android',
      level: 'warn',
      message: 'Bridge warning',
      pid: 4321,
      tag: 'ReactNativeJS',
    });
  });

  it('ignores Android records that are not in threadtime format', () => {
    expect(parseAndroidLogLine('--------- beginning of main', 123, 'example')).toBeUndefined();
  });

  it('parses iOS JSON records and metadata', () => {
    const result = parseIosLogLine(
      JSON.stringify({
        timestamp: '2026-08-08 12:34:56.789+0530',
        messageType: 'Error',
        eventMessage: 'Native request failed',
        subsystem: 'dev.pulsern.example',
        category: 'network',
      }),
      987,
      'dev.pulsern.example',
    );
    expect(result).toMatchObject({
      platform: 'ios',
      level: 'error',
      message: 'Native request failed',
      pid: 987,
      subsystem: 'dev.pulsern.example',
      category: 'network',
    });
  });

  it('rejects malformed iOS records and bounds large messages', () => {
    expect(parseIosLogLine('{broken', 1, 'example')).toBeUndefined();
    const result = parseIosLogLine(
      JSON.stringify({ eventMessage: 'x'.repeat(100_001), messageType: 'Info' }),
      1,
      'example',
    );
    expect(result?.message).toHaveLength(100_000);
    expect(result?.truncated).toBe(true);
  });

  it('extracts pretty-printed iOS JSON array records across chunks', () => {
    const parser = new IosJsonStreamParser();
    expect(parser.push('[{\n  "eventMessage": "first { value",\n')).toEqual([]);
    expect(
      parser.push(
        '  "messageType": "Default"\n},{\n  "eventMessage": "second",\n  "nested": { "ok": true }\n}]',
      ),
    ).toEqual([
      '{\n  "eventMessage": "first { value",\n  "messageType": "Default"\n}',
      '{\n  "eventMessage": "second",\n  "nested": { "ok": true }\n}',
    ]);
  });
});
