import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface UploadFileInput {
  businessId: string;
  entityType: string;
  entityId: string;
  fileName: string;
  fileBuffer?: Buffer;
  mimeType: string;
}

export interface StoredFileResult {
  filePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface IFileStorageService {
  saveFile(input: UploadFileInput): Promise<StoredFileResult>;
}

@Injectable()
export class LocalDiskFileStorageService implements IFileStorageService {
  private readonly uploadDir = path.join(process.cwd(), 'uploads');

  constructor() {
    try {
      if (!fs.existsSync(this.uploadDir)) {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      }
    } catch {
      // Storage directory initialization handled silently
    }
  }

  async saveFile(input: UploadFileInput): Promise<StoredFileResult> {
    const safeFileName = `${Date.now()}-${input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const destinationPath = path.join(this.uploadDir, safeFileName);

    let fileSize = 0;
    if (input.fileBuffer) {
      fs.writeFileSync(destinationPath, input.fileBuffer);
      fileSize = input.fileBuffer.length;
    } else {
      fileSize = 1024; // Simulated stub size
    }

    return {
      filePath: destinationPath,
      fileName: safeFileName,
      fileSize,
      mimeType: input.mimeType,
    };
  }
}
