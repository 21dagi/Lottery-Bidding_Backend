import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HistoryTone,
  LotteryStatus,
  Prisma,
  PrizeKind,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import { DOMAIN_EVENTS } from '../common/events/event-names';
import { etbDecimal, toEtbNumber } from '../common/utils/money';

export type CreatePrizeInput = {
  place: 1 | 2 | 3;
  kind: 'money' | 'product';
  title: string;
  subtitle?: string;
  detail?: string;
  amountEtb?: number;
  imageMediaId?: string;
  specs?: { label: string; value: string }[];
  fulfillmentNote?: string;
};

export type CreateLotteryInput = {
  title: string;
  seriesLabel: string;
  description?: string;
  ticketPriceEtb: number;
  totalTickets: number;
  closesAt: string;
  coverMediaId?: string;
  publish?: boolean;
  prizes: CreatePrizeInput[];
};

@Injectable()
export class LotteriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventsService,
  ) {}

  async create(adminId: string, input: CreateLotteryInput) {
    this.validateCreate(input);
    const status = input.publish ? LotteryStatus.OPEN : LotteryStatus.DRAFT;

    const lottery = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lottery.create({
        data: {
          title: input.title.trim(),
          seriesLabel: input.seriesLabel.trim(),
          description: input.description?.trim() || '',
          coverMediaId: input.coverMediaId,
          ticketQuantity: input.totalTickets,
          ticketPrice: etbDecimal(input.ticketPriceEtb),
          status,
          deadlineAt: new Date(input.closesAt),
          createdByAdminId: adminId,
          prizes: {
            create: input.prizes.map((p) => ({
              place: p.place,
              kind: p.kind as PrizeKind,
              title: p.title,
              subtitle: p.subtitle || '',
              detail: p.detail || '',
              amountEtb:
                p.kind === 'money' ? etbDecimal(p.amountEtb!) : undefined,
              imageMediaId: p.kind === 'product' ? p.imageMediaId : undefined,
              specs: p.specs ?? undefined,
              fulfillmentNote: p.fulfillmentNote,
            })),
          },
        },
        include: {
          prizes: { orderBy: { place: 'asc' } },
          coverMedia: true,
        },
      });

      // Generate ticket inventory in batches
      const batchSize = 500;
      for (let start = 1; start <= input.totalTickets; start += batchSize) {
        const end = Math.min(start + batchSize - 1, input.totalTickets);
        const rows = [];
        for (let n = start; n <= end; n++) {
          rows.push({
            lotteryId: created.id,
            ticketNumber: n,
            status: TicketStatus.AVAILABLE,
          });
        }
        await tx.ticket.createMany({ data: rows });
      }

      await tx.lotteryHistoryEvent.create({
        data: {
          lotteryId: created.id,
          title: status === LotteryStatus.OPEN ? 'Published' : 'Draft created',
          detail:
            status === LotteryStatus.OPEN
              ? 'Lottery is live and open for ticket sales.'
              : 'Lottery draft saved with ticket inventory.',
          tone:
            status === LotteryStatus.OPEN
              ? HistoryTone.accent
              : HistoryTone.neutral,
        },
      });

      return created;
    });

    if (lottery.status === LotteryStatus.OPEN) {
      this.events.emitAfterCommit(DOMAIN_EVENTS.LOTTERY_PUBLISHED, {
        lotteryId: lottery.id,
        adminId,
        title: lottery.title,
        status: lottery.status,
      });
    }

    return this.toAdminDetail(lottery.id);
  }

  async publish(lotteryId: string, adminId: string) {
    const lottery = await this.requireLottery(lotteryId);
    if (
      lottery.status !== LotteryStatus.DRAFT &&
      lottery.status !== LotteryStatus.PUBLISHED
    ) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Only draft lotteries can be published',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.lottery.update({
        where: { id: lotteryId },
        data: { status: LotteryStatus.OPEN },
      });
      await tx.lotteryHistoryEvent.create({
        data: {
          lotteryId,
          title: 'Published',
          detail: 'Lottery opened for ticket sales.',
          tone: HistoryTone.accent,
        },
      });
    });

    this.events.emitAfterCommit(DOMAIN_EVENTS.LOTTERY_PUBLISHED, {
      lotteryId,
      adminId,
      title: lottery.title,
      status: LotteryStatus.OPEN,
    });

    return this.toAdminDetail(lotteryId);
  }

  async lock(lotteryId: string, adminId: string, reason?: string) {
    const lottery = await this.requireLottery(lotteryId);
    if (lottery.status !== LotteryStatus.OPEN) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Only OPEN lotteries can be locked',
      });
    }

    const sold = await this.prisma.ticket.findMany({
      where: { lotteryId, status: TicketStatus.SOLD },
      select: { id: true, ticketNumber: true },
      orderBy: { ticketNumber: 'asc' },
    });

    if (sold.length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Cannot lock with zero sold tickets',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      // Expire any active reservations
      const active = await tx.ticketReservation.findMany({
        where: {
          status: 'ACTIVE',
          ticket: { lotteryId },
        },
        include: { ticket: true },
      });
      for (const r of active) {
        await tx.ticketReservation.update({
          where: { id: r.id },
          data: { status: 'EXPIRED' },
        });
        if (r.ticket.status === TicketStatus.RESERVED) {
          await tx.ticket.update({
            where: { id: r.ticketId },
            data: { status: TicketStatus.AVAILABLE },
          });
        }
      }

      await tx.lottery.update({
        where: { id: lotteryId },
        data: {
          status: LotteryStatus.LOCKED,
          lockReason: reason?.trim() || 'Sales locked for draw',
        },
      });

      // Snapshot for draw fairness — create draw shell without seed yet
      await tx.draw.create({
        data: {
          lotteryId,
          eligibleTicketSnapshot: sold.map((t) => t.id),
          seedCommitHash: '', // filled on commit
          rngAlgorithm: 'sha256-fisher-yates',
        },
      });

      await tx.lotteryHistoryEvent.create({
        data: {
          lotteryId,
          title: 'Locked',
          detail: `Eligible sold tickets frozen: ${sold.length}.`,
          tone: HistoryTone.accent,
        },
      });
    });

    this.events.emitAfterCommit(DOMAIN_EVENTS.LOTTERY_LOCKED, {
      lotteryId,
      adminId,
      title: lottery.title,
      status: LotteryStatus.LOCKED,
      reason,
    });

    return this.toAdminDetail(lotteryId);
  }

  async cancel(lotteryId: string, adminId: string, reason?: string) {
    const lottery = await this.requireLottery(lotteryId);
    if (
      lottery.status !== LotteryStatus.OPEN &&
      lottery.status !== LotteryStatus.DRAFT &&
      lottery.status !== LotteryStatus.PUBLISHED
    ) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Lottery cannot be cancelled in current status',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.lottery.update({
        where: { id: lotteryId },
        data: {
          status: LotteryStatus.CANCELLED,
          lockReason: reason?.trim() || 'Cancelled by admin',
        },
      });
      await tx.lotteryHistoryEvent.create({
        data: {
          lotteryId,
          title: 'Cancelled',
          detail: reason?.trim() || 'Cancelled by admin',
          tone: HistoryTone.danger,
        },
      });
    });

    this.events.emitAfterCommit(DOMAIN_EVENTS.LOTTERY_CANCELLED, {
      lotteryId,
      adminId,
      title: lottery.title,
      status: LotteryStatus.CANCELLED,
      reason,
    });

    return this.toAdminDetail(lotteryId);
  }

  async patch(
    lotteryId: string,
    input: Partial<{
      title: string;
      seriesLabel: string;
      description: string;
      closesAt: string;
      coverMediaId: string;
    }>,
  ) {
    const lottery = await this.requireLottery(lotteryId);
    if (
      lottery.status !== LotteryStatus.DRAFT &&
      lottery.status !== LotteryStatus.OPEN &&
      lottery.status !== LotteryStatus.PUBLISHED
    ) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Lottery is not editable in current status',
      });
    }

    const soldCount = await this.prisma.ticket.count({
      where: { lotteryId, status: { in: [TicketStatus.SOLD, TicketStatus.RESERVED] } },
    });

    await this.prisma.lottery.update({
      where: { id: lotteryId },
      data: {
        title: input.title?.trim(),
        seriesLabel: input.seriesLabel?.trim(),
        description: input.description,
        deadlineAt: input.closesAt ? new Date(input.closesAt) : undefined,
        coverMediaId: input.coverMediaId,
      },
    });

    void soldCount; // quantity changes forbidden after sales — not exposed in patch
    return this.toAdminDetail(lotteryId);
  }

  async listAdmin(opts: { page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 20));
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.lottery.count(),
      this.prisma.lottery.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          prizes: { orderBy: { place: 'asc' }, include: { imageMedia: true } },
          coverMedia: true,
        },
      }),
    ]);

    const items = await Promise.all(
      rows.map(async (l) => this.serializeAdminListItem(l)),
    );
    return { items, total, page, pageSize };
  }

  async toAdminDetail(lotteryId: string) {
    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId },
      include: {
        prizes: { orderBy: { place: 'asc' }, include: { imageMedia: true } },
        coverMedia: true,
        history: { orderBy: { at: 'asc' } },
        winners: {
          include: {
            prize: true,
            ticket: true,
            user: true,
            evidenceMedia: true,
          },
          orderBy: { prize: { place: 'asc' } },
        },
        draws: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!lottery) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lottery not found' });
    }

    const counts = await this.ticketCounts(lotteryId);
    const draw = lottery.draws[0];

    return {
      id: lottery.id,
      title: lottery.title,
      seriesLabel: lottery.seriesLabel,
      description: lottery.description,
      status: this.toAdminStatus(lottery.status),
      ticketPriceEtb: toEtbNumber(lottery.ticketPrice),
      totalTickets: lottery.ticketQuantity,
      ticketsSold: counts.sold,
      ticketsReserved: counts.reserved,
      ticketsAvailable: counts.available,
      coverUrl: lottery.coverMedia?.url,
      closesAt: lottery.deadlineAt.toISOString(),
      createdAt: lottery.createdAt.toISOString(),
      prizes: lottery.prizes.map((p) => this.serializePrize(p)),
      winners: lottery.winners.map((w) => ({
        id: w.id,
        place: w.prize.place as 1 | 2 | 3,
        prizeId: w.prizeId,
        prizeTitle: w.prize.title,
        prizeKind: w.prize.kind,
        ticketNumber: w.ticket.ticketNumber,
        userId: w.userId,
        userName: w.user.displayName,
        fulfillmentStatus: w.payoutStatus,
        evidenceUrl: w.evidenceMedia?.url,
        drawnAt: w.createdAt.toISOString(),
      })),
      history: lottery.history.map((h) => ({
        id: h.id,
        at: h.at.toISOString(),
        title: h.title,
        detail: h.detail,
        tone: h.tone,
      })),
      commitHash: draw?.seedCommitHash || undefined,
      revealedSeed: draw?.seedReveal || undefined,
    };
  }

  async listPublic(tab: 'live' | 'finished', page = 1, pageSize = 20) {
    const where =
      tab === 'live'
        ? {
            status: {
              in: [
                LotteryStatus.OPEN,
                LotteryStatus.PUBLISHED,
                LotteryStatus.LOCKED,
              ],
            },
          }
        : {
            status: {
              in: [LotteryStatus.DRAWN, LotteryStatus.COMPLETED],
            },
          };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.lottery.count({ where }),
      this.prisma.lottery.findMany({
        where,
        orderBy: { deadlineAt: tab === 'live' ? 'asc' : 'desc' },
        skip: (Math.max(1, page) - 1) * pageSize,
        take: Math.min(100, Math.max(1, pageSize)),
        include: {
          prizes: { orderBy: { place: 'asc' }, take: 1 },
          coverMedia: true,
        },
      }),
    ]);

    const items = await Promise.all(
      rows.map(async (l) => {
        const sold = await this.prisma.ticket.count({
          where: { lotteryId: l.id, status: TicketStatus.SOLD },
        });
        return {
          id: l.id,
          title: l.title,
          seriesLabel: l.seriesLabel,
          status: tab === 'live' ? 'live' : 'finished',
          ticketPriceEtb: toEtbNumber(l.ticketPrice),
          rewardLabel: l.prizes[0]?.title || '',
          sold,
          total: l.ticketQuantity,
          closesAt: l.deadlineAt.toISOString(),
          coverUrl: l.coverMedia?.url || '',
        };
      }),
    );

    return { items, total, page, pageSize };
  }

  async getPublicDetail(lotteryId: string, userId?: string) {
    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId },
      include: {
        prizes: { orderBy: { place: 'asc' }, include: { imageMedia: true } },
        coverMedia: true,
        tickets: {
          select: { ticketNumber: true, status: true },
          orderBy: { ticketNumber: 'asc' },
        },
      },
    });
    if (!lottery) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lottery not found' });
    }

    const sold = lottery.tickets.filter((t) => t.status === TicketStatus.SOLD).length;
    let myReservation:
      | { id: string; ticketNumbers: number[]; expiresAt: string }
      | undefined;

    if (userId) {
      const active = await this.prisma.ticketReservation.findMany({
        where: {
          userId,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
          ticket: { lotteryId },
        },
        include: { ticket: true },
        orderBy: { reservedAt: 'asc' },
      });
      if (active.length) {
        myReservation = {
          id: active[0].groupId,
          ticketNumbers: active.map((r) => r.ticket.ticketNumber),
          expiresAt: active[0].expiresAt.toISOString(),
        };
      }
    }

    return {
      id: lottery.id,
      title: lottery.title,
      seriesLabel: lottery.seriesLabel,
      description: lottery.description,
      status: this.toUserDetailStatus(lottery.status),
      ticketPriceEtb: toEtbNumber(lottery.ticketPrice),
      closesAt: lottery.deadlineAt.toISOString(),
      totalTickets: lottery.ticketQuantity,
      soldPercent:
        lottery.ticketQuantity === 0
          ? 0
          : Math.round((sold / lottery.ticketQuantity) * 100),
      coverUrl: lottery.coverMedia?.url,
      prizes: lottery.prizes.map((p) => this.serializePrize(p)),
      tickets: lottery.tickets.map((t) => ({
        number: t.ticketNumber,
        status: this.toPublicTicketStatus(t.status),
      })),
      myReservation,
    };
  }

  async getArchive(lotteryId: string) {
    const detail = await this.toAdminDetail(lotteryId);
    const lottery = await this.requireLottery(lotteryId);
    if (
      lottery.status !== LotteryStatus.DRAWN &&
      lottery.status !== LotteryStatus.COMPLETED
    ) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Archive available only for finished lotteries',
      });
    }

    return {
      lotteryId: detail.id,
      title: detail.title,
      series: detail.seriesLabel,
      seriesLabel: detail.seriesLabel,
      completedAt: detail.history.find((h) => h.title === 'Draw completed')?.at
        || detail.createdAt,
      coverUrl: detail.coverUrl || '',
      ticketPriceEtb: detail.ticketPriceEtb,
      sold: detail.ticketsSold,
      total: detail.totalTickets,
      protocolSeed: detail.revealedSeed || '',
      winners: detail.winners.map((w) => ({
        place: w.place,
        prizeKind: w.prizeKind,
        prizeTitle: w.prizeTitle,
        prizeSubtitle: '',
        prizeImageUrl: undefined,
        ticketNumber: w.ticketNumber,
        username: w.userName,
        displayName: w.userName,
        fulfillmentLabel: w.fulfillmentStatus,
      })),
      proofs: detail.winners
        .filter((w) => w.evidenceUrl)
        .map((w, i) => ({
          id: `proof-${i}`,
          kind: 'image' as const,
          url: w.evidenceUrl!,
          caption: w.prizeTitle,
          category: w.prizeKind === 'money' ? 'payout' : 'delivery',
        })),
      timeline: detail.history.map((h) => ({
        id: h.id,
        atLabel: h.at,
        title: h.title,
        detail: h.detail,
        tone:
          h.tone === 'accent'
            ? 'gold'
            : h.tone === 'danger'
              ? 'neutral'
              : h.tone,
      })),
    };
  }

  private validateCreate(input: CreateLotteryInput) {
    if (!input.title?.trim()) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'title required',
      });
    }
    if (!Number.isFinite(input.ticketPriceEtb) || input.ticketPriceEtb <= 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'ticketPriceEtb must be positive',
      });
    }
    if (!Number.isInteger(input.totalTickets) || input.totalTickets < 1) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'totalTickets must be a positive integer',
      });
    }
    if (input.totalTickets > 100_000) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'totalTickets exceeds max 100000',
      });
    }
    if (!input.prizes?.length || input.prizes.length > 3) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'prizes must be 1–3 places',
      });
    }
    const places = new Set(input.prizes.map((p) => p.place));
    if (places.size !== input.prizes.length) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'prize places must be unique',
      });
    }
    for (const p of input.prizes) {
      if (p.kind === 'money' && !(p.amountEtb && p.amountEtb > 0)) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `money prize place ${p.place} requires amountEtb`,
        });
      }
      if (p.kind === 'product' && !p.imageMediaId) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `product prize place ${p.place} requires imageMediaId`,
        });
      }
    }
    if (Number.isNaN(Date.parse(input.closesAt))) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'closesAt must be ISO date',
      });
    }
  }

  private async requireLottery(id: string) {
    const lottery = await this.prisma.lottery.findUnique({ where: { id } });
    if (!lottery) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lottery not found' });
    }
    return lottery;
  }

  private async ticketCounts(lotteryId: string) {
    const groups = await this.prisma.ticket.groupBy({
      by: ['status'],
      where: { lotteryId },
      _count: true,
    });
    const map = Object.fromEntries(
      groups.map((g) => [g.status, g._count]),
    ) as Record<string, number>;
    return {
      available: map[TicketStatus.AVAILABLE] || 0,
      reserved: map[TicketStatus.RESERVED] || 0,
      sold: map[TicketStatus.SOLD] || 0,
    };
  }

  private async serializeAdminListItem(
    l: Prisma.LotteryGetPayload<{
      include: {
        prizes: { include: { imageMedia: true } };
        coverMedia: true;
      };
    }>,
  ) {
    const counts = await this.ticketCounts(l.id);
    return {
      id: l.id,
      title: l.title,
      seriesLabel: l.seriesLabel,
      description: l.description,
      status: this.toAdminStatus(l.status),
      ticketPriceEtb: toEtbNumber(l.ticketPrice),
      totalTickets: l.ticketQuantity,
      ticketsSold: counts.sold,
      ticketsReserved: counts.reserved,
      ticketsAvailable: counts.available,
      coverUrl: l.coverMedia?.url,
      closesAt: l.deadlineAt.toISOString(),
      createdAt: l.createdAt.toISOString(),
      prizes: l.prizes.map((p) => this.serializePrize(p)),
      winners: [],
      history: [],
    };
  }

  private serializePrize(p: {
    id: string;
    place: number;
    kind: PrizeKind;
    title: string;
    subtitle: string;
    detail: string;
    amountEtb: { toString(): string } | null;
    imageMedia?: { url: string } | null;
    specs: unknown;
    fulfillmentNote: string | null;
  }) {
    return {
      id: p.id,
      place: p.place as 1 | 2 | 3,
      kind: p.kind,
      title: p.title,
      subtitle: p.subtitle,
      detail: p.detail,
      amountEtb: p.amountEtb ? toEtbNumber(p.amountEtb) : undefined,
      imageUrl: p.imageMedia?.url,
      specs: (p.specs as { label: string; value: string }[]) || undefined,
      fulfillmentNote: p.fulfillmentNote || undefined,
    };
  }

  toAdminStatus(status: LotteryStatus) {
    switch (status) {
      case LotteryStatus.PUBLISHED:
      case LotteryStatus.OPEN:
        return 'LIVE';
      case LotteryStatus.DRAWN:
      case LotteryStatus.COMPLETED:
        return 'COMPLETED';
      default:
        return status;
    }
  }

  toUserDetailStatus(status: LotteryStatus) {
    switch (status) {
      case LotteryStatus.PUBLISHED:
      case LotteryStatus.OPEN:
        return 'OPEN';
      case LotteryStatus.LOCKED:
        return 'LOCKED';
      case LotteryStatus.DRAWN:
      case LotteryStatus.COMPLETED:
        return 'COMPLETED';
      case LotteryStatus.CANCELLED:
        return 'CANCELLED';
      default:
        return 'OPEN';
    }
  }

  toPublicTicketStatus(status: TicketStatus) {
    switch (status) {
      case TicketStatus.AVAILABLE:
        return 'AVAILABLE';
      case TicketStatus.RESERVED:
      case TicketStatus.SELECTED:
      case TicketStatus.PAYMENT_PENDING:
        return 'RESERVED';
      case TicketStatus.SOLD:
      case TicketStatus.WINNER:
        return 'SOLD';
      default:
        return 'AVAILABLE';
    }
  }

  assertOpenForSales(status: LotteryStatus) {
    if (status !== LotteryStatus.OPEN) {
      throw new ForbiddenException({
        code: 'LOTTERY_NOT_OPEN',
        message: 'Lottery is not open for ticket sales',
      });
    }
  }
}
