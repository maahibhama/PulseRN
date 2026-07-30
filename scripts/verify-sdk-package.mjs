import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const sdkDir = join(root, 'packages', 'sdk');
const sourceManifest = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8'));
const requestedTag = process.argv[2];
const expectedTag = `sdk-v${sourceManifest.version}`;

if (requestedTag && requestedTag !== expectedTag) {
  throw new Error(`SDK tag ${requestedTag} does not match package version ${expectedTag}.`);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'pulse-rn-sdk-'));

try {
  execFileSync('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@pulse-rn/sdk...'], {
    cwd: root,
    stdio: 'inherit',
  });
  execFileSync(
    'pnpm',
    ['--filter', '@pulse-rn/sdk', 'pack', '--pack-destination', temporaryDirectory],
    { cwd: root, stdio: 'inherit' },
  );

  const archives = readdirSync(temporaryDirectory).filter((file) => file.endsWith('.tgz'));
  if (archives.length !== 1) {
    throw new Error(`Expected one SDK tarball, found ${archives.length}.`);
  }

  const archive = join(temporaryDirectory, archives[0]);
  const extracted = join(temporaryDirectory, 'extracted');
  mkdirSync(extracted);
  execFileSync('tar', ['-xzf', archive, '-C', extracted]);

  const packageRoot = join(extracted, 'package');
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const expectedFiles = [
    'LICENSE',
    'README.md',
    'dist/index.cjs',
    'dist/index.cjs.map',
    'dist/index.d.cts',
    'dist/index.d.ts',
    'dist/index.js',
    'dist/index.js.map',
    'package.json',
  ];
  const actualFiles = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((file) => file && !file.endsWith('/'))
    .map((file) => file.replace(/^package\//, ''))
    .sort();

  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `Unexpected SDK tarball contents.\nExpected: ${expectedFiles.join(', ')}\nActual: ${actualFiles.join(', ')}`,
    );
  }

  if (manifest.version !== sourceManifest.version) {
    throw new Error(`Packed version ${manifest.version} does not match ${sourceManifest.version}.`);
  }
  if (JSON.stringify(Object.keys(manifest.exports ?? {})) !== JSON.stringify(['.'])) {
    throw new Error('The SDK must expose exactly one public package entry point.');
  }

  for (const dependencyGroup of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[dependencyGroup] ?? {})) {
      if (name.startsWith('@pulse-rn/') || String(version).startsWith('workspace:')) {
        throw new Error(`Published ${dependencyGroup} contains internal dependency ${name}.`);
      }
    }
  }

  for (const file of ['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts']) {
    const contents = readFileSync(join(packageRoot, 'dist', file), 'utf8');
    if (contents.includes('@pulse-rn/') || contents.includes('workspace:')) {
      throw new Error(`Published dist/${file} references an internal workspace package.`);
    }
  }

  const requiredExports = [
    'ReactNativeDevTool',
    'createAsyncStorageProvider',
    'createDevToolMiddleware',
    'createMMKVStorageProvider',
    'createNavigationTracker',
    'createPulseRNClient',
    'diffStates',
    'getActiveRoute',
  ];
  const esm = await import(pathToFileURL(join(packageRoot, manifest.module)).href);
  const require = createRequire(import.meta.url);
  const cjs = require(join(packageRoot, manifest.main));
  for (const name of requiredExports) {
    if (typeof esm[name] === 'undefined' || typeof cjs[name] === 'undefined') {
      throw new Error(`Missing root SDK export: ${name}.`);
    }
  }

  const consumerRoot = join(temporaryDirectory, 'consumer');
  const installedPackage = join(consumerRoot, 'node_modules', '@pulse-rn', 'sdk');
  mkdirSync(join(consumerRoot, 'node_modules', '@pulse-rn'), { recursive: true });
  cpSync(packageRoot, installedPackage, { recursive: true });
  writeFileSync(
    join(consumerRoot, 'consumer.mts'),
    `import {
  createAsyncStorageProvider,
  createDevToolMiddleware,
  createMMKVStorageProvider,
  createNavigationTracker,
  createPulseRNClient,
  diffStates,
  getActiveRoute,
} from '@pulse-rn/sdk';

void [
  createAsyncStorageProvider,
  createDevToolMiddleware,
  createMMKVStorageProvider,
  createNavigationTracker,
  createPulseRNClient,
  diffStates,
  getActiveRoute,
];
`,
  );
  writeFileSync(
    join(consumerRoot, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: 'ES2022',
        },
        include: ['consumer.mts'],
      },
      null,
      2,
    ),
  );
  execFileSync(
    join(root, 'node_modules', '.bin', 'tsc'),
    ['-p', join(consumerRoot, 'tsconfig.json')],
    { cwd: consumerRoot, stdio: 'inherit' },
  );

  if (!existsSync(archive)) throw new Error('SDK tarball disappeared during validation.');
  console.log(`Verified ${manifest.name}@${manifest.version}: ${archive}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
