import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ReferralsService } from '../referrals/referrals.service';
import { verifyTelegramInitData } from './telegram/telegram-init-data';
import { DOMAIN_EVENTS } from '../common/events/event-names';
import { toEtbNumber } from '../common/utils/money';

const BCRYPT_COST = 12;
const REFRESH_COOKIE = 'admin_refresh';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly referrals: ReferralsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  get refreshCookieName() {
    return REFRESH_COOKIE;
  }

  async authTelegram(initData: string, startParam?: string) {
    const botToken = this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
    let verified;
    try {
      verified = verifyTelegramInitData(initData, botToken);
    } catch {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid Telegram initData',
      });
    }

    const tg = verified.user;
    const displayName = [tg.first_name, tg.last_name]
      .filter(Boolean)
      .join(' ')
      .trim() || tg.username || `User ${tg.id}`;

    return this.issueUserSession({
      telegramId: String(tg.id),
      telegramUsername: tg.username,
      displayName,
      startParam: startParam || verified.startParam,
    });
  }

  /** Development-only login for browser demos without Telegram HMAC. */
  async devLogin(
    telegramId: string,
    displayName?: string,
    startParam?: string,
  ) {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Dev login disabled',
      });
    }
    return this.issueUserSession({
      telegramId: String(telegramId),
      displayName: displayName || `Demo ${telegramId}`,
      startParam,
    });
  }

  private async issueUserSession(input: {
    telegramId: string;
    telegramUsername?: string;
    displayName: string;
    startParam?: string;
  }) {
    const { user, created } = await this.users.upsertFromTelegram({
      telegramId: input.telegramId,
      telegramUsername: input.telegramUsername,
      displayName: input.displayName,
      referredByStartParam: input.startParam,
    });

    if (user.isBanned) {
      throw new ForbiddenException({
        code: 'USER_BANNED',
        message: user.banReason || 'User is banned',
      });
    }

    if (created) {
      this.events.emit(DOMAIN_EVENTS.USER_REGISTERED, {
        userId: user.id,
        telegramId: user.telegramId,
      });
      await this.referrals.linkReferral(user.id, input.startParam);
    }

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, typ: 'user', telegramId: user.telegramId },
      {
        secret: this.config.getOrThrow<string>('USER_JWT_SECRET'),
        expiresIn: (this.config.get<string>('USER_JWT_EXPIRES_IN') ||
          '7d') as `${number}d`,
      },
    );

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: user.id },
    });

    return {
      accessToken,
      user: this.users.toUserDto(
        user,
        wallet ? toEtbNumber(wallet.cachedBalance) : 0,
      ),
    };
  }

  async adminLogin(username: string, password: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { username } });
    if (!admin) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid credentials',
      });
    }
    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid credentials',
      });
    }

    const accessToken = await this.signAdminAccess(admin);
    const refreshToken = await this.issueAdminRefresh(admin.id);

    return {
      accessToken,
      refreshToken,
      admin: {
        id: admin.id,
        username: admin.username,
        displayName: admin.displayName,
        role: admin.role,
      },
    };
  }

  async adminRefresh(rawRefreshToken: string | undefined) {
    if (!rawRefreshToken) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Missing refresh token',
      });
    }
    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.prisma.adminRefreshToken.findFirst({
      where: { tokenHash, revokedAt: null },
      include: { admin: true },
    });
    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid refresh token',
      });
    }

    // Rotate
    await this.prisma.adminRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const accessToken = await this.signAdminAccess(stored.admin);
    const refreshToken = await this.issueAdminRefresh(stored.adminId);
    return { accessToken, refreshToken };
  }

  async adminLogout(rawRefreshToken: string | undefined) {
    if (!rawRefreshToken) return;
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.adminRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getAdminMe(adminId: string) {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({
      where: { id: adminId },
    });
    return {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
    };
  }

  cookieOptions() {
    // Cross-site admin (Vercel) → API (Render) needs SameSite=None + Secure.
    const sameSite = (this.config.get<string>('COOKIE_SAME_SITE') || 'lax') as
      | 'lax'
      | 'strict'
      | 'none';
    const secure =
      this.config.get<boolean>('COOKIE_SECURE') === true || sameSite === 'none';
    return {
      httpOnly: true,
      secure,
      sameSite,
      path: '/auth/admin',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  }

  private async signAdminAccess(admin: {
    id: string;
    username: string;
    role: string;
  }) {
    return this.jwt.signAsync(
      { sub: admin.id, typ: 'admin', username: admin.username, role: admin.role },
      {
        secret: this.config.getOrThrow<string>('ADMIN_JWT_SECRET'),
        expiresIn: (this.config.get<string>('ADMIN_ACCESS_JWT_EXPIRES_IN') ||
          '15m') as `${number}m`,
      },
    );
  }

  private async issueAdminRefresh(adminId: string) {
    const raw = randomBytes(48).toString('hex');
    const days = 7;
    await this.prisma.adminRefreshToken.create({
      data: {
        adminId,
        tokenHash: this.hashToken(raw),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
    });
    return raw;
  }

  private hashToken(raw: string) {
    return createHash('sha256').update(raw).digest('hex');
  }

  static async hashPassword(password: string) {
    return bcrypt.hash(password, BCRYPT_COST);
  }
}
