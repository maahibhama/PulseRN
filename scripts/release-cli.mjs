import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const args = process.argv.slice(2);
const flags = new Set(args.filter((argument) => argument.startsWith('--')));
const version = args.find((argument) => !argument.startsWith('--'));
const dryRun = flags.has('--dry-run');
const skipChecks = flags.has('--skip-checks');
const replaceTag = flags.has('--replace-tag');
const assumeYes = flags.has('--yes');
const supportedFlags = new Set(['--dry-run', '--skip-checks', '--replace-tag', '--yes']);

for (const flag of flags) {
  if (!supportedFlags.has(flag)) throw new Error(`Unknown option: ${flag}`);
}
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(
    'Usage: pnpm release:cli <X.Y.Z[-prerelease]> [--dry-run] [--skip-checks] [--replace-tag] [--yes]',
  );
}

const tag = `cli-v${version}`;
const root = new URL('..', import.meta.url);
const packageUrl = new URL('../packages/cli/package.json', import.meta.url);
const serverUrl = new URL('../packages/cli/src/server.ts', import.meta.url);
const formulaUrl = new URL('../Formula/pulsern-cli.rb', import.meta.url);
const releasePaths = [
  'packages/cli/package.json',
  'packages/cli/src/server.ts',
  'Formula/pulsern-cli.rb',
  'pnpm-lock.yaml',
];

function execute(command, commandArgs, options = {}) {
  const printable = [command, ...commandArgs].join(' ');
  console.log(`\n$ ${printable}`);
  if (dryRun && options.mutates) return { status: 0, stdout: '', stderr: '' };
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: {
      ...process.env,
      NPM_CONFIG_CACHE: '/tmp/pulsern-npm-cache',
    },
  });
  if (!options.allowedStatuses?.includes(result.status) && result.status !== 0) {
    const details = options.capture
      ? `\n${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd()
      : '';
    throw new Error(`${printable} failed with exit code ${result.status}.${details}`);
  }
  return {
    status: result.status,
    stdout: options.capture ? (result.stdout ?? '').trim() : '',
    stderr: options.capture ? (result.stderr ?? '').trim() : '',
  };
}

async function currentVersions() {
  const metadata = JSON.parse(await readFile(packageUrl, 'utf8'));
  const serverSource = await readFile(serverUrl, 'utf8');
  const formulaSource = await readFile(formulaUrl, 'utf8');
  return {
    packageVersion: metadata.version,
    serverVersion: /const VERSION = '([^']+)';/.exec(serverSource)?.[1],
    formulaVersion: /cli-v([^/]+)\/pulsern-/.exec(formulaSource)?.[1],
    formulaSource,
    metadata,
    serverSource,
  };
}

async function updateVersions() {
  const current = await currentVersions();
  if (
    !current.serverVersion ||
    !current.formulaVersion ||
    current.packageVersion !== current.serverVersion ||
    current.packageVersion !== current.formulaVersion
  ) {
    throw new Error(
      `CLI versions are inconsistent: package=${current.packageVersion}, server=${current.serverVersion}, formula=${current.formulaVersion}.`,
    );
  }
  if (current.packageVersion === version) return false;
  if (dryRun) return true;
  current.metadata.version = version;
  await writeFile(packageUrl, `${JSON.stringify(current.metadata, null, 2)}\n`);
  await writeFile(
    serverUrl,
    current.serverSource.replace(/const VERSION = '[^']+';/, `const VERSION = '${version}';`),
  );
  await writeFile(
    formulaUrl,
    current.formulaSource
      .replace(
        /releases\/download\/cli-v[^/]+\/pulsern-[^"]+\.tgz/,
        `releases/download/${tag}/pulsern-${version}.tgz`,
      )
      .replace(/sha256 "[a-f0-9]{64}"/, `sha256 "${'0'.repeat(64)}"`),
  );
  return true;
}

async function packAndUpdateFormula() {
  const directory = await mkdtemp(join(tmpdir(), 'pulsern-cli-release-'));
  try {
    execute('pnpm', ['--filter', '@maahibhama/pulsern', 'build']);
    execute('pnpm', ['--filter', '@maahibhama/pulsern', 'pack', '--pack-destination', directory]);
    await rename(
      join(directory, `maahibhama-pulsern-${version}.tgz`),
      join(directory, `pulsern-${version}.tgz`),
    );
    const tarball = join(directory, `pulsern-${version}.tgz`);
    const digest = createHash('sha256')
      .update(await readFile(tarball))
      .digest('hex');
    const formula = await readFile(formulaUrl, 'utf8');
    await writeFile(formulaUrl, formula.replace(/sha256 "[a-f0-9]{64}"/, `sha256 "${digest}"`));
    return digest;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const initialStatus = execute('git', ['status', '--porcelain'], { capture: true }).stdout;
if (initialStatus) {
  const dirtyPaths = initialStatus
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  const current = await currentVersions();
  const resumable =
    dirtyPaths.every((path) => releasePaths.includes(path)) &&
    current.packageVersion === version &&
    current.serverVersion === version &&
    current.formulaVersion === version;
  if (!resumable) {
    throw new Error(
      `The working tree must be clean before preparing a CLI release.\n${initialStatus}`,
    );
  }
  console.log(`\nResuming the partially prepared ${tag} release.`);
}

const branch = execute('git', ['branch', '--show-current'], { capture: true }).stdout;
if (!branch) throw new Error('CLI releases cannot be created from a detached HEAD.');
const localTagExists = Boolean(execute('git', ['tag', '--list', tag], { capture: true }).stdout);
const remoteTagExists = Boolean(
  execute('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], { capture: true }).stdout,
);
if ((localTagExists || remoteTagExists) && !replaceTag) {
  throw new Error(
    `${tag} already exists. Use --replace-tag only to recover a failed, unpublished release.`,
  );
}
if (replaceTag) {
  const npmVersion = execute('npm', ['view', `@maahibhama/pulsern@${version}`, 'version'], {
    capture: true,
    allowedStatuses: [1],
  });
  if (npmVersion.status === 0 && npmVersion.stdout === version) {
    throw new Error(`@maahibhama/pulsern@${version} is already published and cannot be replaced.`);
  }
  if (npmVersion.status !== 0 && !/\bE404\b|404 Not Found/i.test(npmVersion.stderr)) {
    throw new Error(`Could not confirm npm publication state.\n${npmVersion.stderr}`);
  }
  const githubRelease = execute('gh', ['release', 'view', tag, '--json', 'isDraft'], {
    capture: true,
    allowedStatuses: [1],
  });
  if (githubRelease.status === 0) {
    throw new Error(`GitHub Release ${tag} already exists and cannot be replaced.`);
  }
}

console.log(`\nPreparing PulseRN CLI ${tag} from branch ${branch}.`);
if (!assumeYes && !dryRun) {
  const prompt = createInterface({ input: stdin, output: stdout });
  const answer = await prompt.question('Continue? [y/N] ');
  prompt.close();
  if (!/^y(?:es)?$/i.test(answer.trim())) {
    console.log('CLI release cancelled.');
    process.exit(0);
  }
}

const changed = await updateVersions();
if (dryRun) {
  console.log(
    `\nWould update the CLI package, runtime, formula, checksum, and lockfile to ${version}.`,
  );
} else {
  execute('pnpm', ['install'], { mutates: true });
  const digest = await packAndUpdateFormula();
  console.log(`\nHomebrew SHA-256: ${digest}`);
  execute('pnpm', ['release:verify:cli', tag]);
}

if (!skipChecks) {
  execute('pnpm', ['typecheck']);
  execute('pnpm', ['test']);
  execute('pnpm', ['lint']);
  execute('pnpm', ['build']);
}

if (!dryRun) {
  const releaseStatus = execute('git', ['status', '--porcelain', '--', ...releasePaths], {
    capture: true,
  }).stdout;
  if (releaseStatus) {
    execute('git', ['add', ...releasePaths], { mutates: true });
    execute('git', ['commit', '-m', `chore(cli): release version ${version}`], { mutates: true });
  } else if (changed) {
    throw new Error('CLI version changed but no release files were available to commit.');
  }
}

execute('git', ['push', '-u', 'origin', branch], { mutates: true });
if (replaceTag && localTagExists) execute('git', ['tag', '-d', tag], { mutates: true });
if (replaceTag && remoteTagExists) {
  execute('git', ['push', 'origin', `:refs/tags/${tag}`], { mutates: true });
}
execute('git', ['tag', '-a', tag, '-m', `PulseRN CLI ${version}`], { mutates: true });
execute('git', ['push', 'origin', tag], { mutates: true });

console.log(
  dryRun
    ? '\nDry run complete. No files, commits, tags, or remotes were changed.'
    : `\n${tag} pushed. GitHub Actions will publish npm and GitHub release artifacts.`,
);
