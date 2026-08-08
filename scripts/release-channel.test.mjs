import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseChannel } from './release-channel.mjs';

test('stable SDK tags use latest despite the sdk-v prefix hyphen', () => {
  assert.deepEqual(releaseChannel('sdk-v1.0.6', 'sdk-v'), {
    version: '1.0.6',
    distTag: 'latest',
  });
});

test('prerelease SDK tags use next', () => {
  assert.deepEqual(releaseChannel('sdk-v1.1.0-beta.1', 'sdk-v'), {
    version: '1.1.0-beta.1',
    distTag: 'next',
  });
});
