import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  LotteryStatus,
  Prisma,
  ReservationStatus,
  TicketStatus,
  WalletTxType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import { DOMAIN_EVENTS } from '../common/events/event-names';
import { LotteriesService } from '../lotteries/lotteries.service';
import { etbDecimal, toEtbNumber } from '../common/utils/money';

const RESERVE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventsService,
    private readonly lotteries: LotteriesService,
  ) {}

  async reserve(userId: string, lotteryId: string, ticketNumbers: number[]) {
    await this.requirePhone(userId);
    if (!ticketNumbers?.length) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'ticketNumbers required',
      });
    }
    const unique = [...new Set(ticketNumbers)];
    if (unique.length !== ticketNumbers.length) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Duplicate ticket numbers',
      });
    }

    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId },
    });
    if (!lottery) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lottery not found' });
    }
    this.lotteries.assertOpenForSales(lottery.status);

    const groupId = randomUUID();
    const expiresAt = new Date(Date.now() + RESERVE_TTL_MS);

    const reserved = await this.prisma.$transaction(async (tx) => {
      // Row lock eligible tickets
      const locked = await tx.$queryRaw<
        Array<{ id: string; ticket_number: number; status: string }>
      >`
        SELECT id, ticket_number, status::text AS status
        FROM tickets
        WHERE lottery_id = ${lotteryId}
          AND ticket_number IN (${Prisma.join(unique)})
        FOR UPDATE
      `;

      if (locked.length !== unique.length) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'One or more ticket numbers are invalid',
        });
      }

      for (const row of locked) {
        if (row.status !== TicketStatus.AVAILABLE) {
          throw new ForbiddenException({
            code: 'TICKET_ALREADY_SOLD',
            message: `Ticket #${row.ticket_number} is not available`,
          });
        }
      }

      // Cancel prior active reservations for this user on this lottery
      const prior = await tx.ticketReservation.findMany({
        where: {
          userId,
          status: ReservationStatus.ACTIVE,
          ticket: { lotteryId },
        },
      });
      for (const r of prior) {
        await tx.ticketReservation.update({
          where: { id: r.id },
          data: { status: ReservationStatus.CANCELLED },
        });
        await tx.ticket.updateMany({
          where: { id: r.ticketId, status: TicketStatus.RESERVED },
          data: { status: TicketStatus.AVAILABLE },
        });
      }

      const out: { ticketId: string; ticketNumber: number; expiresAt: string }[] =
        [];
      for (const row of locked) {
        await tx.ticket.update({
          where: { id: row.id },
          data: { status: TicketStatus.RESERVED },
        });
        await tx.ticketReservation.create({
          data: {
            ticketId: row.id,
            userId,
            expiresAt,
            status: ReservationStatus.ACTIVE,
            groupId,
          },
        });
        out.push({
          ticketId: row.id,
          ticketNumber: row.ticket_number,
          expiresAt: expiresAt.toISOString(),
        });
      }
      return out;
    });

    this.events.emitAfterCommit(DOMAIN_EVENTS.TICKET_RESERVED, {
      lotteryId,
      userId,
      reservationGroupId: groupId,
      tickets: reserved,
    });

    return {
      reservationId: groupId,
      lotteryId,
      expiresAt: expiresAt.toISOString(),
      tickets: reserved.map((t) => ({
        ticketNumber: t.ticketNumber,
        status: 'RESERVED',
        expiresAt: t.expiresAt,
      })),
    };
  }

  async purchase(userId: string, lotteryId: string, reservationId: string) {
    await this.requirePhone(userId);

    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId },
    });
    if (!lottery) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lottery not found' });
    }
    this.lotteries.assertOpenForSales(lottery.status);

    const result = await this.prisma.$transaction(async (tx) => {
      const reservations = await tx.ticketReservation.findMany({
        where: {
          groupId: reservationId,
          userId,
          status: ReservationStatus.ACTIVE,
        },
        include: { ticket: true },
      });

      if (!reservations.length) {
        throw new ForbiddenException({
          code: 'RESERVATION_EXPIRED',
          message: 'Reservation not found or inactive',
        });
      }

      const now = new Date();
      for (const r of reservations) {
        if (r.expiresAt < now) {
          throw new ForbiddenException({
            code: 'RESERVATION_EXPIRED',
            message: 'Reservation expired',
          });
        }
        if (r.ticket.lotteryId !== lotteryId) {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'Reservation does not belong to this lottery',
          });
        }
      }

      const ticketIds = reservations.map((r) => r.ticketId);
      await tx.$queryRaw`
        SELECT id FROM tickets
        WHERE id IN (${Prisma.join(ticketIds)})
        FOR UPDATE
      `;

      for (const r of reservations) {
        const t = await tx.ticket.findUniqueOrThrow({ where: { id: r.ticketId } });
        if (t.status !== TicketStatus.RESERVED) {
          throw new ForbiddenException({
            code: 'TICKET_ALREADY_SOLD',
            message: `Ticket #${t.ticketNumber} is no longer reserved`,
          });
        }
      }

      const unitPrice = toEtbNumber(lottery.ticketPrice);
      const total = unitPrice * reservations.length;

      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Wallet not found' });
      }

      await tx.$queryRaw`
        SELECT id FROM wallets WHERE id = ${wallet.id} FOR UPDATE
      `;

      const balance = toEtbNumber(wallet.cachedBalance);
      if (balance < total) {
        throw new ForbiddenException({
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient wallet balance',
        });
      }

      const amount = etbDecimal(-total);
      const balanceAfter = etbDecimal(balance).plus(amount);

      const ledger = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTxType.PURCHASE,
          amount,
          balanceAfter,
          referenceType: 'purchase',
          referenceId: reservationId,
        },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { cachedBalance: balanceAfter },
      });

      const soldAt = new Date();
      for (const r of reservations) {
        await tx.ticket.update({
          where: { id: r.ticketId },
          data: {
            status: TicketStatus.SOLD,
            ownerUserId: userId,
            soldPrice: lottery.ticketPrice,
            soldAt,
          },
        });
        await tx.ticketReservation.update({
          where: { id: r.id },
          data: { status: ReservationStatus.CONVERTED },
        });
      }

      const purchase = await tx.purchase.create({
        data: {
          userId,
          lotteryId,
          ticketIds,
          totalAmount: etbDecimal(total),
          walletTransactionId: ledger.id,
        },
      });

      return {
        purchase,
        ticketNumbers: reservations.map((r) => r.ticket.ticketNumber),
        ticketIds,
        total,
        ledgerId: ledger.id,
        balanceAfter: toEtbNumber(balanceAfter),
      };
    });

    this.events.emitManyAfterCommit([
      {
        name: DOMAIN_EVENTS.WALLET_DEBITED,
        payload: {
          walletId: '',
          userId,
          amountEtb: -result.total,
          balanceAfter: result.balanceAfter,
          transactionId: result.ledgerId,
          type: WalletTxType.PURCHASE,
        },
      },
      {
        name: DOMAIN_EVENTS.TICKET_PURCHASED,
        payload: {
          lotteryId,
          userId,
          purchaseId: result.purchase.id,
          ticketIds: result.ticketIds,
          ticketNumbers: result.ticketNumbers,
          totalAmountEtb: result.total,
          walletTransactionId: result.ledgerId,
        },
      },
    ]);

    return {
      purchaseId: result.purchase.id,
      lotteryId,
      ticketNumbers: result.ticketNumbers,
      totalAmountEtb: result.total,
      balanceEtb: result.balanceAfter,
    };
  }

  @Cron('*/15 * * * * *')
  async expireReservations() {
    // Advisory lock so multi-instance deploys don't double-expire
    const locks = await this.prisma.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(87236401) AS locked
    `;
    if (!locks[0]?.locked) return;

    try {
      const expired = await this.prisma.ticketReservation.findMany({
        where: {
          status: ReservationStatus.ACTIVE,
          expiresAt: { lt: new Date() },
        },
        include: { ticket: true },
        take: 200,
      });
      if (!expired.length) return;

      const byLotteryUser = new Map<
        string,
        { lotteryId: string; userId: string; tickets: { ticketId: string; ticketNumber: number }[] }
      >();

      await this.prisma.$transaction(async (tx) => {
        for (const r of expired) {
          await tx.ticketReservation.update({
            where: { id: r.id },
            data: { status: ReservationStatus.EXPIRED },
          });
          if (r.ticket.status === TicketStatus.RESERVED) {
            await tx.ticket.update({
              where: { id: r.ticketId },
              data: { status: TicketStatus.AVAILABLE },
            });
          }
          const key = `${r.ticket.lotteryId}:${r.userId}`;
          const bucket = byLotteryUser.get(key) || {
            lotteryId: r.ticket.lotteryId,
            userId: r.userId,
            tickets: [],
          };
          bucket.tickets.push({
            ticketId: r.ticketId,
            ticketNumber: r.ticket.ticketNumber,
          });
          byLotteryUser.set(key, bucket);
        }
      });

      for (const payload of byLotteryUser.values()) {
        this.events.emitAfterCommit(
          DOMAIN_EVENTS.TICKET_RESERVATION_EXPIRED,
          payload,
        );
      }
    } finally {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(87236401)`;
    }
  }

  async listMine(userId: string, tab: 'active' | 'won' | 'history' = 'active') {
    if (tab === 'won') {
      const winners = await this.prisma.winner.findMany({
        where: { userId },
        include: {
          prize: { include: { imageMedia: true } },
          ticket: true,
          lottery: { include: { coverMedia: true } },
          draw: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      return winners.map((w) => ({
        id: w.id,
        winnerId: w.id,
        ticketNumber: w.ticket.ticketNumber,
        lotteryTitle: w.lottery.title,
        place: w.prize.place,
        prizeTitle: w.prize.title,
        prizeKind: w.prize.kind,
        prizeLabel: w.prize.title,
        imageUrl: w.prize.imageMedia?.url || w.lottery.coverMedia?.url || '',
        fulfillmentStatus: w.payoutStatus,
        fulfillmentLabel: w.payoutStatus,
        protocolSeed: w.draw.seedReveal || '',
        evidenceUrl: undefined,
      }));
    }

    if (tab === 'history') {
      // Non-winning sold tickets on finished/cancelled lotteries
      const tickets = await this.prisma.ticket.findMany({
        where: {
          ownerUserId: userId,
          status: TicketStatus.SOLD,
          lottery: {
            status: {
              in: [
                LotteryStatus.COMPLETED,
                LotteryStatus.DRAWN,
                LotteryStatus.CANCELLED,
              ],
            },
          },
          winners: { none: {} },
        },
        include: { lottery: true },
        orderBy: { soldAt: 'desc' },
        take: 100,
      });
      return tickets.map((t) => ({
        id: t.id,
        ticketNumber: t.ticketNumber,
        lotteryTitle: t.lottery.title,
        reason:
          t.lottery.status === LotteryStatus.CANCELLED
            ? 'cancelled'
            : 'not_drawn',
        reasonLabel:
          t.lottery.status === LotteryStatus.CANCELLED
            ? 'Lottery cancelled'
            : 'Did not win',
        struck: true,
      }));
    }

    // active
    const tickets = await this.prisma.ticket.findMany({
      where: {
        ownerUserId: userId,
        status: { in: [TicketStatus.SOLD, TicketStatus.WINNER] },
        lottery: {
          status: {
            in: [
              LotteryStatus.OPEN,
              LotteryStatus.PUBLISHED,
              LotteryStatus.LOCKED,
              LotteryStatus.DRAWN,
            ],
          },
        },
      },
      include: { lottery: { include: { coverMedia: true } } },
      orderBy: { soldAt: 'desc' },
    });

    const byLottery = new Map<string, typeof tickets>();
    for (const t of tickets) {
      const list = byLottery.get(t.lotteryId) || [];
      list.push(t);
      byLottery.set(t.lotteryId, list);
    }

    return [...byLottery.values()].map((group) => {
      const lottery = group[0].lottery;
      const open =
        lottery.status === LotteryStatus.OPEN ||
        lottery.status === LotteryStatus.PUBLISHED;
      return {
        id: lottery.id,
        lotteryId: lottery.id,
        title: lottery.title,
        imageUrl: lottery.coverMedia?.url || '',
        coverUrl: lottery.coverMedia?.url || '',
        statusLabel: open ? 'DRAW OPEN' : 'TICKET LOCKED',
        statusTone: open ? 'open' : 'locked',
        ticketNumbers: group.map((t) => t.ticketNumber),
        closesAt: lottery.deadlineAt.toISOString(),
        totalPaidEtb: group.reduce(
          (s, t) => s + toEtbNumber(t.soldPrice || 0),
          0,
        ),
        showLiveLink: open,
      };
    });
  }

  async listAdminTickets(
    lotteryId: string,
    opts: { status?: TicketStatus; page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize || 50));
    const where = {
      lotteryId,
      ...(opts.status ? { status: opts.status } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        include: {
          owner: true,
          reservations: {
            where: { status: ReservationStatus.ACTIVE },
            orderBy: { reservedAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { ticketNumber: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((t) => ({
        id: t.id,
        lotteryId: t.lotteryId,
        number: t.ticketNumber,
        status: this.lotteries.toPublicTicketStatus(t.status),
        ownerId: t.ownerUserId || undefined,
        ownerName: t.owner?.displayName,
        reservedUntil: t.reservations[0]?.expiresAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  private async requirePhone(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.phoneNumber) {
      throw new ForbiddenException({
        code: 'PHONE_REQUIRED',
        message: 'Phone number required before reserving or purchasing tickets',
      });
    }
  }
}
