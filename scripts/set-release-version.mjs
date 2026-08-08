import { readFile, writeFile } from 'node:fs/promises';

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Usage: node scripts/set-release-version.mjs <X.Y.Z[-prerelease]>');
}

async function updateJson(path) {
  const source = await readFile(path, 'utf8');
  const value = JSON.parse(source);
  value.version = version;
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function replace(path, pattern, replacement, label) {
  const source = await readFile(path, 'utf8');
  if (!pattern.test(source)) {
    throw new Error(`Could not find ${label} in ${path}.`);
  }
  await writeFile(path, source.replace(pattern, replacement));
}

await Promise.all([
  updateJson('package.json'),
  updateJson('apps/desktop/package.json'),
  updateJson('packages/cli/package.json'),
  updateJson('packages/sdk/package.json'),
  replace(
    'packages/cli/src/server.ts',
    /const VERSION = '[^']+';/,
    `const VERSION = '${version}';`,
    'CLI runtime version',
  ),
  replace(
    'packages/sdk/src/client.ts',
    /const SDK_VERSION = '[^']+';/,
    `const SDK_VERSION = '${version}';`,
    'SDK runtime version',
  ),
  replace(
    'Casks/pulsern.rb',
    /^\s*version "[^"]+"/m,
    `  version "${version}"`,
    'desktop Cask version',
  ),
  replace(
    'Formula/pulsern-cli.rb',
    /releases\/download\/cli-v[^/]+\/pulsern-[^"]+\.tgz/,
    `releases/download/cli-v${version}/pulsern-${version}.tgz`,
    'CLI formula URL',
  ),
]);

console.log(`Prepared CLI, SDK, and desktop version ${version}.`);
