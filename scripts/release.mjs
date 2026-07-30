import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const args = process.argv.slice(2);
const flags = new Set(args.filter((argument) => argument.startsWith('--')));
const version = args.find((argument) => !argument.startsWith('--'));
const dryRun = flags.has('--dry-run');
const skipChecks = flags.has('--skip-checks');
const assumeYes = flags.has('--yes');
const supportedFlags = new Set(['--dry-run', '--skip-checks', '--yes']);

for (const flag of flags) {
  if (!supportedFlags.has(flag)) {
    throw new Error(`Unknown option: ${flag}`);
  }
}

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(
    'Usage: pnpm release:desktop <X.Y.Z[-prerelease]> [--dry-run] [--skip-checks] [--yes]',
  );
}

const tag = `v${version}`;
const rootPackageUrl = new URL('../package.json', import.meta.url);
const desktopPackageUrl = new URL('../apps/desktop/package.json', import.meta.url);
const caskUrl = new URL('../Casks/pulsern.rb', import.meta.url);

function run(command, commandArgs, options = {}) {
  const printable = [command, ...commandArgs].join(' ');
  console.log(`\n$ ${printable}`);
  if (dryRun && options.mutates) {
    return '';
  }

  const result = spawnSync(command, commandArgs, {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    const details = options.capture
      ? `\n${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd()
      : '';
    throw new Error(`${printable} failed with exit code ${result.status}.${details}`);
  }
  return options.capture ? (result.stdout ?? '').trim() : '';
}

async function updateJsonVersion(url) {
  const source = await readFile(url, 'utf8');
  const value = JSON.parse(source);
  if (value.version === version) {
    return false;
  }
  value.version = version;
  if (!dryRun) {
    await writeFile(url, `${JSON.stringify(value, null, 2)}\n`);
  }
  return true;
}

async function updateCaskVersion() {
  const source = await readFile(caskUrl, 'utf8');
  const current = /^\s*version "([^"]+)"/m.exec(source)?.[1];
  if (!current) {
    throw new Error('Could not find the version stanza in Casks/pulsern.rb.');
  }
  if (current === version) {
    return false;
  }
  if (!dryRun) {
    await writeFile(caskUrl, source.replace(/^\s*version "[^"]+"/m, `  version "${version}"`));
  }
  return true;
}

const initialStatus = run('git', ['status', '--porcelain'], { capture: true });
if (initialStatus) {
  throw new Error('The working tree must be clean before preparing a release.\n' + initialStatus);
}

const branch = run('git', ['branch', '--show-current'], { capture: true });
if (!branch) {
  throw new Error('Releases cannot be created from a detached HEAD.');
}

const localTag = run('git', ['tag', '--list', tag], { capture: true });
if (localTag) {
  throw new Error(`Local tag ${tag} already exists.`);
}

const remoteTag = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], {
  capture: true,
});
if (remoteTag) {
  throw new Error(`Remote tag ${tag} already exists.`);
}

console.log(`\nPreparing PulseRN ${tag} from branch ${branch}.`);
console.log(
  skipChecks
    ? 'Repository checks will be skipped.'
    : 'Typecheck, tests, lint, and build will run before anything is pushed.',
);

if (!assumeYes && !dryRun) {
  const prompt = createInterface({ input: stdin, output: stdout });
  const answer = await prompt.question('Continue? [y/N] ');
  prompt.close();
  if (!/^y(?:es)?$/i.test(answer.trim())) {
    console.log('Release cancelled.');
    process.exit(0);
  }
}

const changed = [
  await updateJsonVersion(rootPackageUrl),
  await updateJsonVersion(desktopPackageUrl),
  await updateCaskVersion(),
].some(Boolean);

if (dryRun && changed) {
  console.log(`\nWould update package and Cask versions to ${version}.`);
}

if (dryRun && changed) {
  console.log(`\n$ pnpm release:verify ${tag}`);
  console.log('Skipped because dry-run mode does not update version files.');
} else {
  run('pnpm', ['release:verify', tag]);
}

if (!skipChecks) {
  run('pnpm', ['typecheck']);
  run('pnpm', ['test']);
  run('pnpm', ['lint']);
  run('pnpm', ['build']);
}

if (changed) {
  run('git', ['add', 'package.json', 'apps/desktop/package.json', 'Casks/pulsern.rb'], {
    mutates: true,
  });
  run('git', ['commit', '-m', `chore(release): prepare ${tag}`], { mutates: true });
}

run('git', ['push', '-u', 'origin', branch], { mutates: true });
run('git', ['tag', '-a', tag, '-m', `PulseRN ${version}`], {
  mutates: true,
});
run('git', ['push', 'origin', tag], { mutates: true });

console.log(
  dryRun
    ? `\nDry run complete. No files, commits, tags, or remote branches were changed.`
    : `\n${tag} pushed successfully. GitHub Actions is building the public release.`,
);
console.log(`Monitor it with: gh run list --workflow release.yml && gh run watch`);
