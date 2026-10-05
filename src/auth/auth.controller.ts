import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AdminLoginDto, DevLoginDto, TelegramAuthDto } from './dto/auth.dto';
import { AdminJwtGuard } from '../common/guards/admin-jwt.guard';
import { CurrentAdmin } from '../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('telegram')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async telegram(@Body() dto: TelegramAuthDto) {
    return this.auth.authTelegram(dto.initData, dto.startParam);
  }

  /** Local/test only — requires ENABLE_DEV_LOGIN=true. Disabled otherwise. */
  @Post('dev/login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async devLogin(@Body() dto: DevLoginDto) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.ENABLE_DEV_LOGIN !== 'true'
    ) {
      throw new ForbiddenException({
        code: 'UNAUTHORIZED',
        message: 'Dev login disabled',
      });
    }
    return this.auth.devLogin(dto.telegramId, dto.displayName, dto.startParam);
  }

  @Post('admin/login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async adminLogin(
    @Body() dto: AdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.adminLogin(dto.username, dto.password);
    res.cookie(
      this.auth.refreshCookieName,
      result.refreshToken,
      this.auth.cookieOptions(),
    );
    return {
      accessToken: result.accessToken,
      admin: result.admin,
    };
  }

  @Post('admin/refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async adminRefresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = req.cookies?.[this.auth.refreshCookieName] as string | undefined;
    const result = await this.auth.adminRefresh(raw);
    res.cookie(
      this.auth.refreshCookieName,
      result.refreshToken,
      this.auth.cookieOptions(),
    );
    return { accessToken: result.accessToken };
  }

  @Post('admin/logout')
  async adminLogout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = req.cookies?.[this.auth.refreshCookieName] as string | undefined;
    await this.auth.adminLogout(raw);
    res.clearCookie(this.auth.refreshCookieName, this.auth.cookieOptions());
    return { ok: true };
  }

  @Get('admin/me')
  @ApiBearerAuth()
  @UseGuards(AdminJwtGuard)
  async adminMe(@CurrentAdmin() admin: { id: string }) {
    return this.auth.getAdminMe(admin.id);
  }
}
