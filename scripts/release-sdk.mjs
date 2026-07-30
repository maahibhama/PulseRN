import { readFile, writeFile } from 'node:fs/promises';
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
  if (!supportedFlags.has(flag)) {
    throw new Error(`Unknown option: ${flag}`);
  }
}

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(
    'Usage: pnpm release:sdk <X.Y.Z[-prerelease]> [--dry-run] [--skip-checks] [--replace-tag] [--yes]',
  );
}

const tag = `sdk-v${version}`;
const root = new URL('..', import.meta.url);
const sdkPackageUrl = new URL('../packages/sdk/package.json', import.meta.url);
const clientUrl = new URL('../packages/sdk/src/client.ts', import.meta.url);
const releasePaths = ['packages/sdk/package.json', 'packages/sdk/src/client.ts', 'pnpm-lock.yaml'];

function execute(command, commandArgs, options = {}) {
  const printable = [command, ...commandArgs].join(' ');
  console.log(`\n$ ${printable}`);
  if (dryRun && options.mutates) return { status: 0, stderr: '', stdout: '' };

  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (!options.allowedStatuses?.includes(result.status) && result.status !== 0) {
    const details = options.capture
      ? `\n${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd()
      : '';
    throw new Error(`${printable} failed with exit code ${result.status}.${details}`);
  }
  return {
    status: result.status,
    stderr: options.capture ? (result.stderr ?? '').trim() : '',
    stdout: options.capture ? (result.stdout ?? '').trim() : '',
  };
}

async function updateSdkVersion() {
  const packageSource = await readFile(sdkPackageUrl, 'utf8');
  const packageJson = JSON.parse(packageSource);
  const previousVersion = packageJson.version;
  const clientSource = await readFile(clientUrl, 'utf8');
  const currentClientVersion = /const SDK_VERSION = '([^']+)';/.exec(clientSource)?.[1];
  if (!currentClientVersion) {
    throw new Error('Could not find SDK_VERSION in packages/sdk/src/client.ts.');
  }
  if (currentClientVersion !== previousVersion) {
    throw new Error(
      `SDK version sources are already inconsistent: package=${previousVersion}, client=${currentClientVersion}.`,
    );
  }
  if (previousVersion === version) {
    return { changed: false, previousVersion };
  }

  if (!dryRun) {
    packageJson.version = version;
    await writeFile(sdkPackageUrl, `${JSON.stringify(packageJson, null, 2)}\n`);
    await writeFile(
      clientUrl,
      clientSource.replace(/const SDK_VERSION = '[^']+';/, `const SDK_VERSION = '${version}';`),
    );
  }
  return { changed: true, previousVersion };
}

const initialStatus = execute('git', ['status', '--porcelain'], { capture: true }).stdout;
if (initialStatus) {
  const dirtyPaths = initialStatus
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  const onlyReleaseFilesAreDirty = dirtyPaths.every((path) => releasePaths.includes(path));
  const packageVersion = JSON.parse(await readFile(sdkPackageUrl, 'utf8')).version;
  const clientVersion = /const SDK_VERSION = '([^']+)';/.exec(
    await readFile(clientUrl, 'utf8'),
  )?.[1];
  if (!onlyReleaseFilesAreDirty || packageVersion !== version || clientVersion !== version) {
    throw new Error(
      `The working tree must be clean before preparing an SDK release.\n${initialStatus}`,
    );
  }
  console.log(`\nResuming the partially prepared ${tag} release.`);
}

const branch = execute('git', ['branch', '--show-current'], { capture: true }).stdout;
if (!branch) throw new Error('SDK releases cannot be created from a detached HEAD.');

const localTagExists = Boolean(execute('git', ['tag', '--list', tag], { capture: true }).stdout);
const remoteTagExists = Boolean(
  execute('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], {
    capture: true,
  }).stdout,
);

if ((localTagExists || remoteTagExists) && !replaceTag) {
  throw new Error(
    `${tag} already exists. Use --replace-tag only to recover a failed, unpublished release.`,
  );
}

if (replaceTag) {
  const npmVersion = execute('npm', ['view', `@pulse-rn/sdk@${version}`, 'version'], {
    capture: true,
    allowedStatuses: [1],
  });
  if (npmVersion.status === 0 && npmVersion.stdout === version) {
    throw new Error(
      `@pulse-rn/sdk@${version} is already published. Published npm versions and their tags must never be replaced.`,
    );
  }
  if (npmVersion.status !== 0 && !/\bE404\b|404 Not Found/i.test(npmVersion.stderr)) {
    throw new Error(
      `Could not confirm whether @pulse-rn/sdk@${version} is unpublished.\n${npmVersion.stderr}`,
    );
  }
}

console.log(`\nPreparing ${tag} from branch ${branch}.`);
console.log(
  replaceTag
    ? 'An existing failed tag will be replaced after validation and the release commit are pushed.'
    : 'A new SDK release tag will be created after validation and the release commit are pushed.',
);

if (!assumeYes && !dryRun) {
  const prompt = createInterface({ input: stdin, output: stdout });
  const answer = await prompt.question('Continue? [y/N] ');
  prompt.close();
  if (!/^y(?:es)?$/i.test(answer.trim())) {
    console.log('SDK release cancelled.');
    process.exit(0);
  }
}

const versionUpdate = await updateSdkVersion();
console.log(
  versionUpdate.changed
    ? `\nSDK version: ${versionUpdate.previousVersion} -> ${version}`
    : `\nSDK version is already prepared at ${version}; continuing the release.`,
);

if (dryRun) {
  console.log('\nWould update the SDK package, client version, and pnpm lockfile.');
  console.log(`Would validate the packed package against ${tag}.`);
} else {
  execute('pnpm', ['install'], { mutates: true });
  execute('pnpm', ['release:verify:sdk', tag]);
}

if (!skipChecks) {
  execute('pnpm', ['typecheck']);
  execute('pnpm', ['test']);
  execute('pnpm', ['lint']);
  execute('pnpm', ['build']);
}

const releaseStatus = execute('git', ['status', '--porcelain', '--', ...releasePaths], {
  capture: true,
}).stdout;
if (releaseStatus) {
  execute('git', ['add', ...releasePaths], { mutates: true });
  execute('git', ['commit', '-m', `chore(sdk): release version ${version}`], {
    mutates: true,
  });
} else {
  console.log('\nSDK version changes are already committed.');
}
execute('git', ['push', '-u', 'origin', branch], { mutates: true });

if (replaceTag && localTagExists) {
  execute('git', ['tag', '-d', tag], { mutates: true });
}
if (replaceTag && remoteTagExists) {
  execute('git', ['push', 'origin', `:refs/tags/${tag}`], { mutates: true });
}

execute('git', ['tag', '-a', tag, '-m', `PulseRN SDK ${version}`], {
  mutates: true,
});
execute('git', ['push', 'origin', tag], { mutates: true });

console.log(
  dryRun
    ? '\nDry run complete. No files, commits, tags, or remotes were changed.'
    : `\n${tag} pushed successfully. GitHub Actions will publish @pulse-rn/sdk@${version}.`,
);
console.log('Monitor: GitHub → Actions → Release SDK');
