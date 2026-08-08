import { describe, expect, it } from 'vitest';
import { parseOptions } from './options.js';

describe('parseOptions', () => {
  it('uses safe local defaults', () => {
    const options = parseOptions([]);
    expect(options).not.toBe('help');
    expect(options).not.toBe('version');
    if (typeof options === 'string') return;
    expect(options).toMatchObject({
      port: 3000,
      sdkPort: 9090,
      metroHost: '127.0.0.1',
      metroPort: 8081,
      host: '127.0.0.1',
      open: true,
    });
  });

  it('parses supported overrides', () => {
    expect(
      parseOptions([
        '--port',
        '3100',
        '--sdk-port',
        '9191',
        '--metro-host',
        'host.test',
        '--metro-port',
        '8181',
        '--host',
        '0.0.0.0',
        '--data-dir',
        './state',
        '--no-open',
        '--reset-browser-token',
        '--telemetry',
        'on',
      ]),
    ).toMatchObject({
      port: 3100,
      sdkPort: 9191,
      metroHost: 'host.test',
      metroPort: 8181,
      host: '0.0.0.0',
      open: false,
      resetBrowserToken: true,
      telemetry: true,
    });
  });

  it('rejects invalid ports and unknown options', () => {
    expect(() => parseOptions(['--port', '0'])).toThrow(/between 1 and 65535/);
    expect(() => parseOptions(['--unknown'])).toThrow(/Unknown option/);
    expect(() => parseOptions(['--telemetry', 'maybe'])).toThrow(/must be on or off/);
  });
});
