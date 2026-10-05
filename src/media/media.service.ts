import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadedByType } from '@prisma/client';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private uploadDir() {
    const dir = this.config.get<string>('MEDIA_UPLOAD_DIR') || './uploads';
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  async saveUpload(input: {
    file: Express.Multer.File;
    uploadedByType: UploadedByType;
    uploadedById: string;
  }) {
    const max = this.config.get<number>('MEDIA_MAX_BYTES') || 5_242_880;
    if (!ALLOWED_MIME.has(input.file.mimetype)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Only image uploads are allowed',
      });
    }
    if (input.file.size > max) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `File exceeds max size of ${max} bytes`,
      });
    }

    const ext = extname(input.file.originalname).toLowerCase() || '.bin';
    const filename = `${randomUUID()}${ext}`;
    const abs = join(this.uploadDir(), filename);
    await pipeline(Readable.from(input.file.buffer), createWriteStream(abs));

    const baseUrl =
      this.config.get<string>('MEDIA_BASE_URL') ||
      'http://localhost:3000/media/files';
    const url = `${baseUrl.replace(/\/$/, '')}/${filename}`;

    const media = await this.prisma.media.create({
      data: {
        url,
        mimeType: input.file.mimetype,
        sizeBytes: input.file.size,
        uploadedByType: input.uploadedByType,
        uploadedById: input.uploadedById,
      },
    });

    return { id: media.id, url: media.url };
  }

  async getAuthorized(
    mediaId: string,
    actor: { type: 'USER' | 'ADMIN'; id: string },
  ) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Media not found' });
    }
    if (actor.type === 'USER' && media.uploadedById !== actor.id) {
      throw new ForbiddenException({
        code: 'UNAUTHORIZED',
        message: 'Not allowed to access this media',
      });
    }
    return {
      id: media.id,
      url: media.url,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      createdAt: media.createdAt.toISOString(),
    };
  }

  resolveFilePath(filename: string) {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    return join(this.uploadDir(), safe);
  }
}
