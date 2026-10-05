import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadedByType } from '@prisma/client';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private configured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private parseCloudinaryUrl(raw: string): {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
  } {
    let url = raw.trim();
    if (
      (url.startsWith('"') && url.endsWith('"')) ||
      (url.startsWith("'") && url.endsWith("'"))
    ) {
      url = url.slice(1, -1);
    }

    // Prefer URL parsing so secrets with URL-encoding still work.
    try {
      const parsed = new URL(url.replace(/^cloudinary:\/\//i, 'https://'));
      const apiKey = decodeURIComponent(parsed.username || '');
      const apiSecret = decodeURIComponent(parsed.password || '');
      const cloudName = parsed.hostname;
      if (apiKey && apiSecret && cloudName) {
        return { cloudName, apiKey, apiSecret };
      }
    } catch {
      // fall through to regex
    }

    const match = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/i.exec(url);
    if (!match) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message:
          'CLOUDINARY_URL must look like cloudinary://API_KEY:API_SECRET@CLOUD_NAME',
      });
    }
    return {
      apiKey: match[1],
      apiSecret: match[2],
      cloudName: match[3],
    };
  }

  private ensureCloudinary() {
    if (this.configured) return;
    const url = this.config.get<string>('CLOUDINARY_URL');
    if (!url?.trim()) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'CLOUDINARY_URL is not configured',
      });
    }

    const { cloudName, apiKey, apiSecret } = this.parseCloudinaryUrl(url);

    if (
      apiKey.includes('<') ||
      apiSecret.includes('<') ||
      apiKey === 'your_api_key' ||
      apiSecret === 'your_api_secret'
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message:
          'CLOUDINARY_URL still has placeholder credentials. Set the real API key and secret from the Cloudinary dashboard.',
      });
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
    this.configured = true;
  }

  private uploadToCloudinary(
    buffer: Buffer,
    folder: string,
  ): Promise<UploadApiResponse> {
    this.ensureCloudinary();
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          overwrite: false,
        },
        (err, result) => {
          if (err || !result) {
            reject(err ?? new Error('Cloudinary upload failed'));
            return;
          }
          resolve(result);
        },
      );
      stream.end(buffer);
    });
  }

  async saveUpload(input: {
    file: Express.Multer.File;
    uploadedByType: UploadedByType;
    uploadedById: string;
  }) {
    const max = this.config.get<number>('MEDIA_MAX_BYTES') || 5_242_880;
    if (!input.file?.buffer?.length) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Empty upload — file buffer missing',
      });
    }
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

    let uploaded: UploadApiResponse;
    try {
      uploaded = await this.uploadToCloudinary(input.file.buffer, 'lottery-bid');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Cloudinary upload failed';
      this.logger.error(`Cloudinary upload failed: ${message}`);
      throw new BadGatewayException({
        code: 'UPLOAD_FAILED',
        message: `Image upload failed: ${message}`,
      });
    }

    const url = uploaded.secure_url || uploaded.url;
    if (!url) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Cloudinary did not return an image URL',
      });
    }

    const media = await this.prisma.media.create({
      data: {
        url,
        mimeType: input.file.mimetype,
        sizeBytes: input.file.size,
        uploadedByType: input.uploadedByType,
        uploadedById: input.uploadedById,
      },
    });

    return {
      id: media.id,
      url: media.url,
      publicId: uploaded.public_id,
    };
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
}
