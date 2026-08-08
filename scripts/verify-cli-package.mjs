import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tag = process.argv[2];
const packageDirectory = new URL('../packages/cli/', import.meta.url);
const formulaUrl = new URL('../Formula/pulsern-cli.rb', import.meta.url);
const metadata = JSON.parse(await readFile(new URL('package.json', packageDirectory), 'utf8'));

if (tag && tag !== `cli-v${metadata.version}`) {
  throw new Error(`CLI tag ${tag} does not match pulsern@${metadata.version}.`);
}
if (
  metadata.name !== 'pulsern' ||
  metadata.bin?.pulsern !== './dist/server.js' ||
  metadata.bin?.['pulsern-mcp'] !== './dist/mcp-server.js'
) {
  throw new Error('The CLI package name or executable mapping is invalid.');
}
if (metadata.engines?.node !== '>=22.5') {
  throw new Error('The CLI must retain its Node.js >=22.5 requirement.');
}
for (const path of ['dist/server.js', 'dist/mcp-server.js', 'dist/public/index.html']) {
  const file = await stat(new URL(path, packageDirectory));
  if (!file.isFile() || file.size === 0) throw new Error(`${path} is missing or empty.`);
}

const directory = await mkdtemp(join(tmpdir(), 'pulsern-cli-verify-'));
try {
  const inspected = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: packageDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      NPM_CONFIG_CACHE: '/tmp/pulsern-npm-cache',
    },
  });
  if (inspected.status !== 0) throw new Error(inspected.stderr || 'npm pack validation failed.');
  const result = JSON.parse(inspected.stdout)[0];
  const files = new Set(result.files.map((entry) => entry.path));
  for (const required of ['dist/server.js', 'dist/mcp-server.js', 'dist/public/index.html']) {
    if (!files.has(required)) throw new Error(`Packed CLI is missing ${required}.`);
  }
  if (
    Object.values(metadata.dependencies ?? {}).some((value) =>
      String(value).startsWith('workspace:'),
    )
  ) {
    throw new Error('Published CLI runtime dependencies cannot use workspace ranges.');
  }

  const packed = spawnSync(
    'pnpm',
    ['--filter', 'pulsern', 'pack', '--pack-destination', directory],
    {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
    },
  );
  if (packed.status !== 0) throw new Error(packed.stderr || 'pnpm pack validation failed.');
  const tarball = join(directory, `pulsern-${metadata.version}.tgz`);
  const digest = createHash('sha256')
    .update(await readFile(tarball))
    .digest('hex');
  const formula = await readFile(formulaUrl, 'utf8');
  const formulaHash = /^\s*sha256 "([a-f0-9]{64})"/m.exec(formula)?.[1];
  const expectedUrl = `releases/download/cli-v${metadata.version}/pulsern-${metadata.version}.tgz`;
  if (!formula.includes(expectedUrl))
    throw new Error('Homebrew formula URL does not match the CLI.');
  if (formulaHash !== digest) {
    throw new Error(
      `Homebrew formula SHA-256 mismatch: formula=${formulaHash}, package=${digest}.`,
    );
  }

  console.log(
    `Verified pulsern@${metadata.version} (${result.entryCount} files, sha256 ${digest}).`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
