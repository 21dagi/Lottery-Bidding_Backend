import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { HistoryTone } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DOMAIN_EVENTS,
  DrawCommittedPayload,
  DrawCompletedPayload,
  LotteryLifecyclePayload,
  WinnerPayoutUpdatedPayload,
  WinnerSelectedPayload,
} from '../../common/events/event-names';

/**
 * Appends lottery-scoped history from domain events (idempotent-ish by title+detail window).
 */
@Injectable()
export class LotteryHistoryListener {
  constructor(private readonly prisma: PrismaService) {}

  private async append(
    lotteryId: string,
    title: string,
    detail: string,
    tone: HistoryTone,
  ) {
    // Soft idempotency: skip duplicate title within last 5s
    const recent = await this.prisma.lotteryHistoryEvent.findFirst({
      where: {
        lotteryId,
        title,
        at: { gte: new Date(Date.now() - 5000) },
      },
    });
    if (recent) return;
    await this.prisma.lotteryHistoryEvent.create({
      data: { lotteryId, title, detail, tone },
    });
  }

  @OnEvent(DOMAIN_EVENTS.DRAW_COMMITTED)
  async onCommit(p: DrawCommittedPayload) {
    await this.append(
      p.lotteryId,
      'Seed committed',
      `Commit hash ${p.commitHash.slice(0, 12)}… published before reveal.`,
      HistoryTone.accent,
    );
  }

  @OnEvent(DOMAIN_EVENTS.DRAW_COMPLETED)
  async onDraw(p: DrawCompletedPayload) {
    await this.append(
      p.lotteryId,
      'Draw completed',
      `Seed revealed; ${p.winnerIds.length} winner(s) selected.`,
      HistoryTone.success,
    );
  }

  @OnEvent(DOMAIN_EVENTS.WINNER_SELECTED)
  async onWinner(p: WinnerSelectedPayload) {
    await this.append(
      p.lotteryId,
      `Winner place ${p.place}`,
      `Ticket #${p.ticketNumber} selected for prize.`,
      HistoryTone.success,
    );
  }

  @OnEvent(DOMAIN_EVENTS.WINNER_PAYOUT_UPDATED)
  async onPayout(p: WinnerPayoutUpdatedPayload) {
    await this.append(
      p.lotteryId,
      'Fulfillment updated',
      `Winner ${p.winnerId} → ${p.status}`,
      HistoryTone.neutral,
    );
  }

  // Lifecycle history is written inline in LotteriesService for transactional consistency.
  @OnEvent(DOMAIN_EVENTS.LOTTERY_PUBLISHED)
  async onPublished(_p: LotteryLifecyclePayload) {
    // no-op — history written in service transaction
  }
}
