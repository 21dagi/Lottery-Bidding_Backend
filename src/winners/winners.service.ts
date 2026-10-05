import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LotteryStatus, PayoutStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import { DOMAIN_EVENTS } from '../common/events/event-names';

@Injectable()
export class WinnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventsService,
  ) {}

  async fulfill(
    lotteryId: string,
    winnerId: string,
    adminId: string,
    input: { status: PayoutStatus; evidenceMediaId?: string; notes?: string },
  ) {
    const allowed: PayoutStatus[] = [
      PayoutStatus.PENDING,
      PayoutStatus.CONTACTED,
      PayoutStatus.PAID,
      PayoutStatus.DELIVERED,
      PayoutStatus.CREDITED,
      PayoutStatus.FAILED,
    ];
    if (!allowed.includes(input.status)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid fulfillment status',
      });
    }

    const winner = await this.prisma.winner.findFirst({
      where: { id: winnerId, lotteryId },
      include: {
        prize: true,
        ticket: true,
        user: true,
        evidenceMedia: true,
      },
    });
    if (!winner) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Winner not found' });
    }

    if (input.evidenceMediaId) {
      const media = await this.prisma.media.findUnique({
        where: { id: input.evidenceMediaId },
      });
      if (!media) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Invalid evidenceMediaId',
        });
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const w = await tx.winner.update({
        where: { id: winnerId },
        data: {
          payoutStatus: input.status,
          payoutEvidenceMediaId:
            input.evidenceMediaId ?? winner.payoutEvidenceMediaId,
          payoutNotes: input.notes?.trim() || winner.payoutNotes,
          updatedByAdminId: adminId,
        },
        include: {
          prize: true,
          ticket: true,
          user: true,
          evidenceMedia: true,
        },
      });

      // Mark lottery COMPLETED when all winners fulfilled to terminal state
      const pending = await tx.winner.count({
        where: {
          lotteryId,
          payoutStatus: {
            in: [PayoutStatus.PENDING, PayoutStatus.CONTACTED],
          },
        },
      });
      if (pending === 0) {
        await tx.lottery.updateMany({
          where: {
            id: lotteryId,
            status: { in: [LotteryStatus.DRAWN, LotteryStatus.LOCKED] },
          },
          data: { status: LotteryStatus.COMPLETED },
        });
      }

      return w;
    });

    this.events.emitAfterCommit(DOMAIN_EVENTS.WINNER_PAYOUT_UPDATED, {
      lotteryId,
      winnerId: updated.id,
      userId: updated.userId,
      status: updated.payoutStatus,
      adminId,
    });

    return {
      id: updated.id,
      place: updated.prize.place as 1 | 2 | 3,
      prizeId: updated.prizeId,
      prizeTitle: updated.prize.title,
      prizeKind: updated.prize.kind,
      ticketNumber: updated.ticket.ticketNumber,
      userId: updated.userId,
      userName: updated.user.displayName,
      fulfillmentStatus: updated.payoutStatus,
      evidenceUrl:
        updated.evidenceMedia?.url ||
        updated.payoutNotes?.replace(/^Evidence:\s*/i, '') ||
        undefined,
      drawnAt: updated.createdAt.toISOString(),
    };
  }
}
