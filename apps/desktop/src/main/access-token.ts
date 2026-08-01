import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class AccessTokenStore {
  private token: string;

  constructor(private readonly filePath: string) {
    this.token = this.read() ?? this.generateAndWrite();
  }

  get(): string {
    return this.token;
  }

  rotate(): string {
    this.token = this.generateAndWrite();
    return this.token;
  }

  private read(): string | undefined {
    try {
      const token = readFileSync(this.filePath, 'utf8').trim();
      return TOKEN_PATTERN.test(token) ? token : undefined;
    } catch {
      return undefined;
    }
  }

  private generateAndWrite(): string {
    const token = randomBytes(32).toString('base64url');
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
    return token;
  }
}
