import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Response, Request } from 'express';
import { existsSync } from 'fs';
import { MediaService } from './media.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UploadedByType } from '@prisma/client';

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  @Post('upload')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5_242_880 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request & { headers: { authorization?: string } },
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'file is required',
      });
    }

    const actor = await this.resolveActor(req.headers.authorization);
    return this.media.saveUpload({
      file,
      uploadedByType:
        actor.type === 'ADMIN' ? UploadedByType.ADMIN : UploadedByType.USER,
      uploadedById: actor.id,
    });
  }

  /** Public file serve by filename (URL stored on Media.url). Must be before :id */
  @Get('files/:filename')
  async serveFile(@Param('filename') filename: string, @Res() res: Response) {
    const path = this.media.resolveFilePath(filename);
    if (!existsSync(path)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'File not found' });
    }
    return res.sendFile(path);
  }

  @Get(':id')
  @ApiBearerAuth()
  async get(
    @Param('id') id: string,
    @Req() req: Request & { headers: { authorization?: string } },
  ) {
    const actor = await this.resolveActor(req.headers.authorization);
    return this.media.getAuthorized(id, actor);
  }

  private async resolveActor(authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Missing bearer token',
      });
    }
    const token = authorization.slice(7);

    try {
      const admin = await this.jwt.verifyAsync<{ sub: string; typ: string }>(
        token,
        { secret: this.config.getOrThrow<string>('ADMIN_JWT_SECRET') },
      );
      if (admin.typ === 'admin') return { type: 'ADMIN' as const, id: admin.sub };
    } catch {
      // try user
    }

    try {
      const user = await this.jwt.verifyAsync<{ sub: string; typ: string }>(
        token,
        { secret: this.config.getOrThrow<string>('USER_JWT_SECRET') },
      );
      if (user.typ === 'user') return { type: 'USER' as const, id: user.sub };
    } catch {
      // fallthrough
    }

    throw new UnauthorizedException({
      code: 'UNAUTHORIZED',
      message: 'Invalid token',
    });
  }
}
