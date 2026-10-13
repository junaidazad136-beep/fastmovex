import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

// OWASP 2024 recommendation for argon2id
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, OPTIONS);
  }

  /** Run a real verify even when the user does not exist, so response time does not reveal valid accounts. */
  async burnTime(plain: string): Promise<void> {
    this.dummyHash ??= this.hash('fmx-timing-equalizer-password-1');
    await this.verify(await this.dummyHash, plain);
  }
}
