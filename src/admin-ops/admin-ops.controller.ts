import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  DepositStatus,
  LotteryStatus,
  PayoutStatus,
  TicketStatus,
  WalletTxType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminJwtGuard } from '../common/guards/admin-jwt.guard';
import { toEtbNumber } from '../common/utils/money';

@ApiTags('admin-dashboard')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@Controller('admin')
export class AdminOpsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('dashboard')
  async dashboard() {
    const since = new Date();
    since.setDate(since.getDate() - 6);
    since.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      bannedUsers,
      pendingDeposits,
      walletAgg,
      liveLotteries,
      finishedLotteries,
      ticketsSold,
      pendingFulfillments,
      deposits,
      purchases,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isBanned: true } }),
      this.prisma.deposit.count({ where: { status: DepositStatus.PENDING } }),
      this.prisma.wallet.aggregate({ _sum: { cachedBalance: true } }),
      this.prisma.lottery.count({
        where: {
          status: {
            in: [LotteryStatus.OPEN, LotteryStatus.PUBLISHED, LotteryStatus.LOCKED],
          },
        },
      }),
      this.prisma.lottery.count({
        where: {
          status: { in: [LotteryStatus.DRAWN, LotteryStatus.COMPLETED] },
        },
      }),
      this.prisma.ticket.count({ where: { status: TicketStatus.SOLD } }),
      this.prisma.winner.count({
        where: {
          payoutStatus: { in: [PayoutStatus.PENDING, PayoutStatus.CONTACTED] },
        },
      }),
      this.prisma.deposit.findMany({
        where: { createdAt: { gte: since }, status: DepositStatus.APPROVED },
        select: { amount: true, createdAt: true },
      }),
      this.prisma.walletTransaction.findMany({
        where: {
          type: WalletTxType.PURCHASE,
          createdAt: { gte: since },
        },
        select: { amount: true, createdAt: true },
      }),
    ]);

    const depositsByDay = new Map<string, number>();
    const salesByDay = new Map<string, number>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      depositsByDay.set(key, 0);
      salesByDay.set(key, 0);
    }
    for (const dep of deposits) {
      const key = dep.createdAt.toISOString().slice(0, 10);
      depositsByDay.set(
        key,
        (depositsByDay.get(key) || 0) + toEtbNumber(dep.amount),
      );
    }
    for (const p of purchases) {
      const key = p.createdAt.toISOString().slice(0, 10);
      // purchase amounts are negative in ledger
      salesByDay.set(
        key,
        (salesByDay.get(key) || 0) + Math.abs(toEtbNumber(p.amount)),
      );
    }

    return {
      liveLotteries,
      finishedLotteries,
      totalUsers,
      activeUsers: totalUsers - bannedUsers,
      bannedUsers,
      pendingDeposits,
      ticketsSold,
      walletBalancesTotal: toEtbNumber(walletAgg._sum.cachedBalance ?? 0),
      pendingFulfillments,
      salesTrend: Array.from(depositsByDay.keys()).map((date) => ({
        date,
        sales: salesByDay.get(date) || 0,
        deposits: depositsByDay.get(date) || 0,
      })),
    };
  }

  @Get('audit-logs')
  async auditLogs() {
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        actorType: r.actorType,
        actorId: r.actorId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      })),
      total: rows.length,
      page: 1,
      pageSize: 100,
    };
  }
}
