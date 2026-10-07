import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class PlatformSettingsService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly encryptionKey: Buffer;

  constructor(private readonly prisma: PrismaService) {
    const rawKey = process.env.SYSTEM_SETTINGS_KEY || 'default-system-settings-key-32b';
    // Ensure key is 32 bytes
    this.encryptionKey = Buffer.alloc(32);
    Buffer.from(rawKey).copy(this.encryptionKey);
  }

  private encrypt(plainText: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algorithm, this.encryptionKey, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  private decrypt(cipherText: string): string {
    const [ivHex, authTagHex, encryptedHex] = cipherText.split(':');
    if (!ivHex || !authTagHex || !encryptedHex) return cipherText;

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(this.algorithm, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Internal method for backend services to obtain decrypted value safely.
   */
  async getDecryptedValue(key: string): Promise<string | null> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
    if (!setting) return null;
    if (setting.is_encrypted) {
      try {
        return this.decrypt(setting.value);
      } catch {
        return setting.value;
      }
    }
    return setting.value;
  }

  async listSettings() {
    const settings = await this.prisma.systemSetting.findMany({
      orderBy: { key: 'asc' },
    });

    // Mask encrypted values
    return settings.map((s) => ({
      ...s,
      value: s.is_encrypted ? '******' : s.value,
    }));
  }

  async getSetting(key: string) {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
    if (!setting) throw new NotFoundException(`Setting with key "${key}" not found.`);

    return {
      ...setting,
      value: setting.is_encrypted ? '******' : setting.value,
    };
  }

  async setSetting(dto: {
    key: string;
    value: string;
    description?: string;
    isEncrypted?: boolean;
  }) {
    const isEncrypted = Boolean(dto.isEncrypted);
    const storedValue = isEncrypted ? this.encrypt(dto.value) : dto.value;

    const result = await this.prisma.systemSetting.upsert({
      where: { key: dto.key },
      update: {
        value: storedValue,
        description: dto.description,
        is_encrypted: isEncrypted,
      },
      create: {
        key: dto.key,
        value: storedValue,
        description: dto.description || null,
        is_encrypted: isEncrypted,
      },
    });

    return {
      ...result,
      value: isEncrypted ? '******' : dto.value,
    };
  }
}
