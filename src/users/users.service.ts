import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DOMAIN_EVENTS } from '../common/events/event-names';
import { toEtbNumber } from '../common/utils/money';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async upsertFromTelegram(input: {
    telegramId: string;
    telegramUsername?: string;
    displayName: string;
    referredByStartParam?: string;
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { telegramId: input.telegramId },
    });
    if (existing) {
      const user = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          telegramUsername: input.telegramUsername ?? existing.telegramUsername,
          displayName: input.displayName || existing.displayName,
        },
      });
      return { user, created: false };
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          telegramId: input.telegramId,
          telegramUsername: input.telegramUsername,
          displayName: input.displayName,
        },
      });
      await tx.wallet.create({ data: { userId: created.id } });
      return created;
    });

    return { user, created: true };
  }

  async getById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { wallet: true },
    });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
    return user;
  }

  async updatePhone(userId: string, phoneNumber: string) {
    const cleaned = phoneNumber.trim();
    if (cleaned.length < 8) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid phone number',
      });
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { phoneNumber: cleaned },
      include: { wallet: true },
    });
    return this.toUserDto(user, toEtbNumber(user.wallet?.cachedBalance ?? 0));
  }

  async listAdmin(params: {
    q?: string;
    status?: 'ACTIVE' | 'BANNED';
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const where = {
      ...(params.status === 'ACTIVE' ? { isBanned: false } : {}),
      ...(params.status === 'BANNED' ? { isBanned: true } : {}),
      ...(params.q
        ? {
            OR: [
              { displayName: { contains: params.q, mode: 'insensitive' as const } },
              { telegramUsername: { contains: params.q, mode: 'insensitive' as const } },
              { telegramId: { contains: params.q } },
              { phoneNumber: { contains: params.q } },
            ],
          }
        : {}),
    };

    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: { wallet: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: users.map((u) => this.toAdminUserDto(u)),
      total,
      page,
      pageSize,
    };
  }

  async ban(userId: string, reason: string) {
    if (!reason?.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Ban reason is required',
      });
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { isBanned: true, banReason: reason.trim() },
      include: { wallet: true },
    });
    this.events.emit(DOMAIN_EVENTS.USER_BANNED, {
      userId: user.id,
      reason: reason.trim(),
      banned: true,
    });
    return this.toAdminUserDto(user);
  }

  async unban(userId: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { isBanned: false, banReason: null },
      include: { wallet: true },
    });
    this.events.emit(DOMAIN_EVENTS.USER_BANNED, {
      userId: user.id,
      reason: '',
      banned: false,
    });
    return this.toAdminUserDto(user);
  }

  toUserDto(user: User, balanceEtb = 0) {
    return {
      id: user.id,
      telegramId: user.telegramId,
      username: user.telegramUsername ?? undefined,
      displayName: user.displayName,
      phoneNumber: user.phoneNumber,
      isBanned: user.isBanned,
      banReason: user.banReason ?? undefined,
      createdAt: user.createdAt.toISOString(),
      wallet: { balanceEtb },
    };
  }

  toAdminUserDto(
    user: User & { wallet?: { cachedBalance: { toString(): string } } | null },
  ) {
    return {
      id: user.id,
      telegramId: user.telegramId,
      displayName: user.displayName,
      phone: user.phoneNumber || '',
      status: user.isBanned ? ('BANNED' as const) : ('ACTIVE' as const),
      walletBalance: toEtbNumber(user.wallet?.cachedBalance ?? 0),
      ticketsPurchased: 0, // Job 2
      createdAt: user.createdAt.toISOString(),
      banReason: user.banReason ?? undefined,
    };
  }
}
