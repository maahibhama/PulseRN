import { X509Certificate, randomUUID } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface TlsCertificateInfo {
  configured: boolean;
  fingerprint256?: string;
  subject?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
}

export interface TlsCredentials {
  cert: Buffer;
  key: Buffer;
}

export class TlsCertificateStore {
  constructor(
    private readonly certificatePath: string,
    private readonly privateKeyPath: string,
  ) {}

  install(certificate: Buffer, privateKey: Buffer): TlsCertificateInfo {
    const parsed = this.validate(certificate, privateKey);
    this.writeSecurely(this.certificatePath, certificate, 0o600);
    this.writeSecurely(this.privateKeyPath, privateKey, 0o600);
    return this.describe(parsed);
  }

  credentials(): TlsCredentials | undefined {
    try {
      const cert = readFileSync(this.certificatePath);
      const key = readFileSync(this.privateKeyPath);
      this.validate(cert, key);
      return { cert, key };
    } catch {
      return undefined;
    }
  }

  info(): TlsCertificateInfo {
    const credentials = this.credentials();
    if (!credentials) return { configured: false };
    return this.describe(new X509Certificate(credentials.cert));
  }

  remove(): void {
    rmSync(this.certificatePath, { force: true });
    rmSync(this.privateKeyPath, { force: true });
  }

  private validate(certificate: Buffer, privateKey: Buffer): X509Certificate {
    if (certificate.byteLength > 1024 * 1024 || privateKey.byteLength > 1024 * 1024) {
      throw new Error('TLS certificate and key files must each be no larger than 1 MiB.');
    }
    const parsed = new X509Certificate(certificate);
    createSecureContext({ cert: certificate, key: privateKey });
    if (Date.parse(parsed.validFrom) > Date.now()) {
      throw new Error('The selected TLS certificate is not valid yet.');
    }
    if (Date.parse(parsed.validTo) <= Date.now()) {
      throw new Error('The selected TLS certificate has expired.');
    }
    return parsed;
  }

  private describe(certificate: X509Certificate): TlsCertificateInfo {
    return {
      configured: true,
      fingerprint256: certificate.fingerprint256,
      subject: certificate.subject,
      issuer: certificate.issuer,
      validFrom: certificate.validFrom,
      validTo: certificate.validTo,
    };
  }

  private writeSecurely(path: string, contents: Buffer, mode: number): void {
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, contents, { mode });
    renameSync(temporaryPath, path);
  }
}
