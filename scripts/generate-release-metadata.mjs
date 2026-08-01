import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const releaseDirectory = resolve(process.argv[2] ?? 'apps/desktop/release');
const version = (process.argv[3] ?? '').replace(/^v/, '');
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Usage: generate-release-metadata.mjs <release-directory> <version>');
}
if (!existsSync(releaseDirectory))
  throw new Error(`Missing release directory: ${releaseDirectory}`);

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const artifacts = readdirSync(releaseDirectory)
  .filter((file) => /\.(?:dmg|zip|exe|AppImage|deb)$/.test(file))
  .sort()
  .map((file) => ({ file, sha256: sha256(join(releaseDirectory, file)) }));
if (artifacts.length === 0) throw new Error('No release artifacts were found.');

const architectures = {
  version,
  generatedAt: new Date().toISOString(),
  artifacts: artifacts.map(({ file, sha256: checksum }) => ({
    file,
    sha256: checksum,
    platform: file.includes('-mac-') ? 'macos' : file.includes('-windows-') ? 'windows' : 'linux',
    architecture: file.includes('-arm64')
      ? 'arm64'
      : file.includes('-x64') || file.includes('AppImage') || file.includes('.deb')
        ? 'x86_64'
        : 'unknown',
  })),
};
writeFileSync(
  join(releaseDirectory, 'ARCHITECTURES.json'),
  `${JSON.stringify(architectures, null, 2)}\n`,
);

const root = resolve(import.meta.dirname, '..');
const manifests = [
  join(root, 'package.json'),
  join(root, 'apps', 'desktop', 'package.json'),
  join(root, 'packages', 'protocol', 'package.json'),
  join(root, 'packages', 'shared', 'package.json'),
]
  .map((path) => JSON.parse(readFileSync(path, 'utf8')))
  .flatMap((manifest) => [
    { name: manifest.name, version: manifest.version },
    ...Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).map(
      ([name, dependencyVersion]) => ({
        name,
        version: String(dependencyVersion).replace(/^[~^]/, ''),
      }),
    ),
  ]);
const uniquePackages = [
  ...new Map(manifests.map((item) => [`${item.name}@${item.version}`, item])).values(),
];
const documentHash = createHash('sha256')
  .update(JSON.stringify({ version, artifacts }))
  .digest('hex');
const spdxId = (value) => `SPDXRef-${value.replace(/[^A-Za-z0-9.-]/g, '-')}`;
const sbom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `PulseRN-${version}`,
  documentNamespace: `https://github.com/maahibhama/PulseRN/releases/tag/v${version}/sbom-${documentHash}`,
  creationInfo: {
    created: new Date().toISOString(),
    creators: ['Tool: PulseRN release metadata generator'],
  },
  packages: uniquePackages.map((item) => ({
    SPDXID: spdxId(`${item.name}-${item.version}`),
    name: item.name,
    versionInfo: item.version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
  })),
  files: artifacts.map((artifact) => ({
    SPDXID: spdxId(basename(artifact.file)),
    fileName: artifact.file,
    checksums: [{ algorithm: 'SHA256', checksumValue: artifact.sha256 }],
    licenseConcluded: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
  })),
  relationships: uniquePackages.map((item) => ({
    spdxElementId: 'SPDXRef-DOCUMENT',
    relationshipType: 'DESCRIBES',
    relatedSpdxElement: spdxId(`${item.name}-${item.version}`),
  })),
};
writeFileSync(join(releaseDirectory, 'SBOM.spdx.json'), `${JSON.stringify(sbom, null, 2)}\n`);
console.log(`Generated SBOM and architecture report for ${artifacts.length} artifacts.`);
