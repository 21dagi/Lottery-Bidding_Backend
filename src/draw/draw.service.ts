import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HistoryTone,
  LotteryStatus,
  PayoutStatus,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import { DOMAIN_EVENTS } from '../common/events/event-names';
import {
  commitSeed,
  selectWinnersDeterministic,
  sha256Hex,
} from './draw-rng';

@Injectable()
export class DrawService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventsService,
  ) {}

  async commit(lotteryId: string, adminId: string) {
    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId },
    });
    if (!lottery) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lottery not found' });
    }
    if (lottery.status !== LotteryStatus.LOCKED) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Lottery must be LOCKED before seed commit',
      });
    }

    let draw = await this.prisma.draw.findFirst({
      where: { lotteryId },
      orderBy: { createdAt: 'desc' },
    });
    if (!draw) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'No draw snapshot — lock the lottery first',
      });
    }
    if (draw.seedReveal) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Draw already revealed',
      });
    }
    if (draw.seedCommitHash) {
      return { commitHash: draw.seedCommitHash };
    }

    const { seedHex, commitHash } = commitSeed();
    draw = await this.prisma.draw.update({
      where: { id: draw.id },
      data: {
        seedCommitHash: commitHash,
        seedCipher: seedHex, // held server-side until reveal
      },
    });

    await this.prisma.lotteryHistoryEvent.create({
      data: {
        lotteryId,
        title: 'Seed committed',
        detail: `Commit hash ${commitHash.slice(0, 16)}…`,
        tone: HistoryTone.accent,
      },
    });

    this.events.emitAfterCommit(DOMAIN_EVENTS.DRAW_COMMITTED, {
      lotteryId,
      drawId: draw.id,
      commitHash,
      adminId,
    });

    return { commitHash };
  }

  async reveal(lotteryId: string, adminId: string) {
    const lottery = await this.prisma.lottery.findUnique({
      where: { id: lotteryId },
      include: { prizes: { orderBy: { place: 'asc' } } },
    });
    if (!lottery) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lottery not found' });
    }
    if (lottery.status !== LotteryStatus.LOCKED) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Lottery must be LOCKED for reveal',
      });
    }

    const draw = await this.prisma.draw.findFirst({
      where: { lotteryId },
      orderBy: { createdAt: 'desc' },
    });
    if (!draw?.seedCommitHash || !draw.seedCipher) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Commit seed before reveal',
      });
    }
    if (draw.seedReveal) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Draw already revealed',
      });
    }

    const seedHex = draw.seedCipher;
    if (sha256Hex(seedHex) !== draw.seedCommitHash) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Seed integrity check failed',
      });
    }

    const snapshot = draw.eligibleTicketSnapshot as string[];
    if (!Array.isArray(snapshot) || !snapshot.length) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Empty eligible snapshot',
      });
    }

    const prizes = lottery.prizes;
    if (prizes.length > snapshot.length) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Not enough sold tickets for all prizes',
      });
    }

    const winnerTicketIds = selectWinnersDeterministic(
      seedHex,
      snapshot,
      prizes.length,
    );

    const { winners, commitHash } = await this.prisma.$transaction(
      async (tx) => {
        await tx.draw.update({
          where: { id: draw.id },
          data: {
            seedReveal: seedHex,
            seedCipher: null,
            executedByAdminId: adminId,
            executedAt: new Date(),
          },
        });

        const created = [];
        for (let i = 0; i < prizes.length; i++) {
          const ticketId = winnerTicketIds[i];
          const ticket = await tx.ticket.findUniqueOrThrow({
            where: { id: ticketId },
            include: { owner: true },
          });
          if (!ticket.ownerUserId) {
            throw new ConflictException({
              code: 'CONFLICT',
              message: `Winning ticket ${ticket.ticketNumber} has no owner`,
            });
          }

          await tx.ticket.update({
            where: { id: ticketId },
            data: { status: TicketStatus.WINNER },
          });

          const winner = await tx.winner.create({
            data: {
              drawId: draw.id,
              lotteryId,
              prizeId: prizes[i].id,
              ticketId,
              userId: ticket.ownerUserId,
              payoutStatus: PayoutStatus.PENDING,
            },
            include: {
              prize: true,
              ticket: true,
              user: true,
            },
          });
          created.push(winner);
        }

        await tx.lottery.update({
          where: { id: lotteryId },
          data: { status: LotteryStatus.DRAWN },
        });

        await tx.lotteryHistoryEvent.create({
          data: {
            lotteryId,
            title: 'Draw completed',
            detail: `${created.length} winner(s) selected.`,
            tone: HistoryTone.success,
          },
        });

        return { winners: created, commitHash: draw.seedCommitHash };
      },
    );

    const winnerPayloads = winners.map((w) => ({
      name: DOMAIN_EVENTS.WINNER_SELECTED,
      payload: {
        lotteryId,
        drawId: draw.id,
        winnerId: w.id,
        userId: w.userId,
        prizeId: w.prizeId,
        ticketNumber: w.ticket.ticketNumber,
        place: w.prize.place,
      },
    }));

    this.events.emitManyAfterCommit([
      {
        name: DOMAIN_EVENTS.DRAW_COMPLETED,
        payload: {
          lotteryId,
          drawId: draw.id,
          commitHash,
          revealedSeed: seedHex,
          adminId,
          winnerIds: winners.map((w) => w.id),
        },
      },
      ...winnerPayloads,
    ]);

    return {
      lotteryId,
      commitHash,
      revealedSeed: seedHex,
      winners: winners.map((w) => ({
        id: w.id,
        place: w.prize.place as 1 | 2 | 3,
        prizeId: w.prizeId,
        prizeTitle: w.prize.title,
        prizeKind: w.prize.kind,
        ticketNumber: w.ticket.ticketNumber,
        userId: w.userId,
        userName: w.user.displayName,
        fulfillmentStatus: w.payoutStatus,
        drawnAt: w.createdAt.toISOString(),
      })),
    };
  }
}
