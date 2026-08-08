import { resolve } from 'node:path';
import { homedir } from 'node:os';

export interface CliOptions {
  port: number;
  sdkPort: number;
  metroHost: string;
  metroPort: number;
  host: string;
  dataDir: string;
  open: boolean;
  resetBrowserToken: boolean;
}

function platformDataDirectory(): string {
  if (process.platform === 'win32') {
    return resolve(process.env['LOCALAPPDATA'] || homedir(), 'PulseRN', 'web');
  }
  if (process.platform === 'darwin') {
    return resolve(homedir(), 'Library', 'Application Support', 'PulseRN', 'web');
  }
  return resolve(process.env['XDG_STATE_HOME'] || resolve(homedir(), '.local', 'state'), 'pulsern');
}

function port(value: string | undefined, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${option} must be an integer between 1 and 65535.`);
  }
  return parsed;
}

export const HELP = `PulseRN local web debugger

Usage: pulsern [options]

  --port <number>          Browser/API port (default: 3000)
  --sdk-port <number>      React Native SDK port (default: 9090)
  --metro-host <hostname>  Metro host (default: 127.0.0.1)
  --metro-port <number>    Metro port (default: 8081)
  --host <address>         Browser bind address (default: 127.0.0.1)
  --data-dir <path>        Persistent data directory
  --no-open                Do not open the browser
  --reset-browser-token    Revoke saved browser sessions
  --help                   Show this help
  --version                Show the version
`;

export function parseOptions(args: string[]): CliOptions | 'help' | 'version' {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const valueOptions = new Set([
    '--port',
    '--sdk-port',
    '--metro-host',
    '--metro-port',
    '--host',
    '--data-dir',
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--help') return 'help';
    if (argument === '--version') return 'version';
    if (argument === '--no-open' || argument === '--reset-browser-token') {
      flags.add(argument);
      continue;
    }
    if (!valueOptions.has(argument)) throw new Error(`Unknown option: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
    values.set(argument, value);
    index += 1;
  }
  return {
    port: port(values.get('--port') ?? '3000', '--port'),
    sdkPort: port(values.get('--sdk-port') ?? '9090', '--sdk-port'),
    metroHost: values.get('--metro-host') ?? '127.0.0.1',
    metroPort: port(values.get('--metro-port') ?? '8081', '--metro-port'),
    host: values.get('--host') ?? '127.0.0.1',
    dataDir: resolve(values.get('--data-dir') ?? platformDataDirectory()),
    open: !flags.has('--no-open'),
    resetBrowserToken: flags.has('--reset-browser-token'),
  };
}
