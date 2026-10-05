import {
  BadRequestException,
  ForbiddenException,
  Injectable,
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
  private configured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private ensureCloudinary() {
    if (this.configured) return;
    const url = this.config.get<string>('CLOUDINARY_URL');
    if (!url) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'CLOUDINARY_URL is not configured',
      });
    }
    const match = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url.trim());
    if (!match) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message:
          'CLOUDINARY_URL must look like cloudinary://API_KEY:API_SECRET@CLOUD_NAME',
      });
    }
    cloudinary.config({
      cloud_name: match[3],
      api_key: match[1],
      api_secret: match[2],
      secure: true,
    });
    this.configured = true;
  }

  private uploadToCloudinary(
    buffer: Buffer,
    mimeType: string,
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

    const uploaded = await this.uploadToCloudinary(
      input.file.buffer,
      input.file.mimetype,
      'lottery-bid',
    );

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
