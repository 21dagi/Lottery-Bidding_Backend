import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WalletTxType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import {
  DOMAIN_EVENTS,
  DepositApprovedPayload,
  TicketPurchasedPayload,
} from '../common/events/event-names';
import { etbDecimal, toEtbNumber } from '../common/utils/money';

/**
 * Listens to purchase/deposit events and credits referrer per ReferralRule.
 * Idempotent via unique (sourceType, sourceId, ruleApplied).
 */
@Injectable()
export class ReferralsListener {
  private readonly logger = new Logger(ReferralsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventsService,
  ) {}

  @OnEvent(DOMAIN_EVENTS.TICKET_PURCHASED)
  async onPurchase(payload: TicketPurchasedPayload) {
    await this.creditFromPurchase(payload);
  }

  @OnEvent(DOMAIN_EVENTS.DEPOSIT_APPROVED)
  async onDeposit(payload: DepositApprovedPayload) {
    await this.creditFromDeposit(payload);
  }

  private async ensureRule() {
    return this.prisma.referralRule.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        enabled: true,
        purchasePercent: etbDecimal(5),
        depositFlatEtb: etbDecimal(0),
      },
      update: {},
    });
  }

  private async creditFromPurchase(payload: TicketPurchasedPayload) {
    const rule = await this.ensureRule();
    if (!rule.enabled) return;
    const pct = toEtbNumber(rule.purchasePercent);
    if (pct <= 0) return;

    const referral = await this.prisma.referral.findUnique({
      where: { referredUserId: payload.userId },
    });
    if (!referral) return;

    const amount = Math.round(payload.totalAmountEtb * (pct / 100) * 100) / 100;
    if (amount <= 0) return;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.referralReward.findUnique({
          where: {
            sourceType_sourceId_ruleApplied: {
              sourceType: 'purchase',
              sourceId: payload.purchaseId,
              ruleApplied: `purchase_percent_${pct}`,
            },
          },
        });
        if (existing) return null;

        const wallet = await tx.wallet.findUnique({
          where: { userId: referral.referrerUserId },
        });
        if (!wallet) return null;

        const balanceAfter = etbDecimal(
          toEtbNumber(wallet.cachedBalance),
        ).plus(etbDecimal(amount));

        const ledger = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: WalletTxType.REFERRAL,
            amount: etbDecimal(amount),
            balanceAfter,
            referenceType: 'referral_reward',
            referenceId: payload.purchaseId,
            reason: `Referral ${pct}% of purchase`,
          },
        });
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { cachedBalance: balanceAfter },
        });

        const reward = await tx.referralReward.create({
          data: {
            referralId: referral.id,
            walletTransactionId: ledger.id,
            amount: etbDecimal(amount),
            ruleApplied: `purchase_percent_${pct}`,
            sourceType: 'purchase',
            sourceId: payload.purchaseId,
          },
        });

        return {
          reward,
          ledgerId: ledger.id,
          referrerUserId: referral.referrerUserId,
          amount,
        };
      });

      if (result) {
        this.events.emitAfterCommit(DOMAIN_EVENTS.REFERRAL_REWARD_CREDITED, {
          referralId: referral.id,
          referrerUserId: result.referrerUserId,
          amountEtb: result.amount,
          walletTransactionId: result.ledgerId,
          sourceType: 'purchase',
          sourceId: payload.purchaseId,
        });
        this.events.emitAfterCommit(DOMAIN_EVENTS.WALLET_CREDITED, {
          walletId: '',
          userId: result.referrerUserId,
          amountEtb: result.amount,
          balanceAfter: 0,
          transactionId: result.ledgerId,
          type: WalletTxType.REFERRAL,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Referral purchase credit skipped: ${(err as Error).message}`,
      );
    }
  }

  private async creditFromDeposit(payload: DepositApprovedPayload) {
    const rule = await this.ensureRule();
    if (!rule.enabled) return;
    const flat = toEtbNumber(rule.depositFlatEtb);
    if (flat <= 0) return;

    const referral = await this.prisma.referral.findUnique({
      where: { referredUserId: payload.userId },
    });
    if (!referral) return;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.referralReward.findUnique({
          where: {
            sourceType_sourceId_ruleApplied: {
              sourceType: 'deposit',
              sourceId: payload.depositId,
              ruleApplied: `deposit_flat_${flat}`,
            },
          },
        });
        if (existing) return null;

        const wallet = await tx.wallet.findUnique({
          where: { userId: referral.referrerUserId },
        });
        if (!wallet) return null;

        const balanceAfter = etbDecimal(
          toEtbNumber(wallet.cachedBalance),
        ).plus(etbDecimal(flat));
        const ledger = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: WalletTxType.REFERRAL,
            amount: etbDecimal(flat),
            balanceAfter,
            referenceType: 'referral_reward',
            referenceId: payload.depositId,
            reason: `Referral deposit bonus ${flat} ETB`,
          },
        });
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { cachedBalance: balanceAfter },
        });
        await tx.referralReward.create({
          data: {
            referralId: referral.id,
            walletTransactionId: ledger.id,
            amount: etbDecimal(flat),
            ruleApplied: `deposit_flat_${flat}`,
            sourceType: 'deposit',
            sourceId: payload.depositId,
          },
        });
        return { ledgerId: ledger.id, amount: flat };
      });

      if (result) {
        this.events.emitAfterCommit(DOMAIN_EVENTS.REFERRAL_REWARD_CREDITED, {
          referralId: referral.id,
          referrerUserId: referral.referrerUserId,
          amountEtb: result.amount,
          walletTransactionId: result.ledgerId,
          sourceType: 'deposit',
          sourceId: payload.depositId,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Referral deposit credit skipped: ${(err as Error).message}`,
      );
    }
  }
}
