import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { TlsCertificateStore } from './tls-certificate.js';

const temporaryDirectories: string[] = [];
const fixtureDirectory = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
const certificate = readFileSync(join(fixtureDirectory, 'test-certificate.pem'));
const privateKey = readFileSync(join(fixtureDirectory, 'test-private-key.pem'));

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), 'pulse-rn-tls-'));
  temporaryDirectories.push(directory);
  return {
    certificatePath: join(directory, 'certificate.pem'),
    privateKeyPath: join(directory, 'private-key.pem'),
    store: new TlsCertificateStore(
      join(directory, 'certificate.pem'),
      join(directory, 'private-key.pem'),
    ),
  };
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('TlsCertificateStore', () => {
  it('validates, persists, and reloads a certificate and matching private key', () => {
    const { certificatePath, privateKeyPath, store } = createStore();

    expect(store.install(certificate, privateKey)).toMatchObject({
      configured: true,
      subject: 'CN=PulseRN Test',
      issuer: 'CN=PulseRN Test',
    });
    expect(store.info()).toMatchObject({ configured: true, subject: 'CN=PulseRN Test' });
    expect(store.credentials()).toEqual({ cert: certificate, key: privateKey });
    expect(statSync(certificatePath).mode & 0o777).toBe(0o600);
    expect(statSync(privateKeyPath).mode & 0o777).toBe(0o600);
  });

  it('rejects invalid credentials without reporting a configured certificate', () => {
    const { store } = createStore();

    expect(() => store.install(certificate, Buffer.from('not a private key'))).toThrow();
    expect(store.info()).toEqual({ configured: false });
  });

  it('removes installed credentials', () => {
    const { store } = createStore();
    store.install(certificate, privateKey);

    store.remove();

    expect(store.credentials()).toBeUndefined();
    expect(store.info()).toEqual({ configured: false });
  });
});
