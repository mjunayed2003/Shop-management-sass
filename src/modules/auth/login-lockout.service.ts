import { Injectable, ForbiddenException } from '@nestjs/common';

interface LockoutRecord {
  attempts: number;
  lockedUntil?: number;
}

@Injectable()
export class LoginLockoutService {
  private readonly attemptsMap = new Map<string, LockoutRecord>();
  private readonly MAX_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

  private getKey(identifier: string, ip?: string): string {
    return `${identifier.toLowerCase()}:${ip || 'unknown'}`;
  }

  checkLockout(identifier: string, ip?: string): void {
    const key = this.getKey(identifier, ip);
    const record = this.attemptsMap.get(key);

    if (record?.lockedUntil) {
      if (Date.now() < record.lockedUntil) {
        const minutesLeft = Math.ceil((record.lockedUntil - Date.now()) / (60 * 1000));
        throw new ForbiddenException(
          `Account is temporarily locked due to repeated failed login attempts. Please try again in ${minutesLeft} minute(s).`,
        );
      } else {
        // Lockout expired: reset
        this.attemptsMap.delete(key);
      }
    }
  }

  recordFailure(identifier: string, ip?: string): void {
    const key = this.getKey(identifier, ip);
    const record = this.attemptsMap.get(key) || { attempts: 0 };
    record.attempts += 1;

    if (record.attempts >= this.MAX_ATTEMPTS) {
      record.lockedUntil = Date.now() + this.LOCKOUT_DURATION_MS;
    }

    this.attemptsMap.set(key, record);
  }

  recordSuccess(identifier: string, ip?: string): void {
    const key = this.getKey(identifier, ip);
    this.attemptsMap.delete(key);
  }
}
