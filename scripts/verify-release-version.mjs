import { readFile } from 'node:fs/promises';

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;

if (!tag) {
  throw new Error('Pass a release tag such as v0.1.0.');
}

const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
if (!match) {
  throw new Error(`Release tag "${tag}" must use the form vX.Y.Z or vX.Y.Z-prerelease.`);
}

const expectedVersion = match[1];
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const rootPackage = await readJson(new URL('../package.json', import.meta.url));
const desktopPackage = await readJson(
  new URL('../apps/desktop/package.json', import.meta.url),
);
const cask = await readFile(
  new URL('../Casks/pulsern.rb', import.meta.url),
  'utf8',
);
const caskVersion = /^\s*version "([^"]+)"/m.exec(cask)?.[1];

const versions = {
  'package.json': rootPackage.version,
  'apps/desktop/package.json': desktopPackage.version,
  'Casks/pulsern.rb': caskVersion,
};

for (const [path, version] of Object.entries(versions)) {
  if (version !== expectedVersion) {
    throw new Error(
      `${path} has version ${String(version)}, but tag ${tag} requires ${expectedVersion}.`,
    );
  }
}

console.log(`Release versions match ${tag}.`);
