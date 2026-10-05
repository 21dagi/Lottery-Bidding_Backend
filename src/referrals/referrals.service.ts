import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { etbDecimal, toEtbNumber } from '../common/utils/money';

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRules() {
    const rule = await this.prisma.referralRule.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        enabled: true,
        purchasePercent: etbDecimal(5),
        depositFlatEtb: etbDecimal(0),
      },
      update: {},
    });
    return {
      enabled: rule.enabled,
      purchasePercent: toEtbNumber(rule.purchasePercent),
      depositFlatEtb: toEtbNumber(rule.depositFlatEtb),
    };
  }

  async updateRules(input: {
    enabled: boolean;
    purchasePercent: number;
    depositFlatEtb: number;
  }) {
    const rule = await this.prisma.referralRule.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        enabled: input.enabled,
        purchasePercent: etbDecimal(input.purchasePercent),
        depositFlatEtb: etbDecimal(input.depositFlatEtb),
      },
      update: {
        enabled: input.enabled,
        purchasePercent: etbDecimal(input.purchasePercent),
        depositFlatEtb: etbDecimal(input.depositFlatEtb),
      },
    });
    return {
      enabled: rule.enabled,
      purchasePercent: toEtbNumber(rule.purchasePercent),
      depositFlatEtb: toEtbNumber(rule.depositFlatEtb),
    };
  }

  async listRewards(opts: { page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 20));
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.referralReward.count(),
      this.prisma.referralReward.findMany({
        include: {
          referral: {
            include: {
              referrer: true,
              referred: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        amountEtb: toEtbNumber(r.amount),
        ruleApplied: r.ruleApplied,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        referrerUserId: r.referral.referrerUserId,
        referrerName: r.referral.referrer.displayName,
        referredUserId: r.referral.referredUserId,
        referredName: r.referral.referred.displayName,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async myReferrals(userId: string) {
    const rows = await this.prisma.referral.findMany({
      where: { referrerUserId: userId },
      include: {
        referred: true,
        rewards: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      referralCode: userId, // Mini App can use startParam=ref_<userId>
      invited: rows.map((r) => ({
        userId: r.referredUserId,
        displayName: r.referred.displayName,
        joinedAt: r.createdAt.toISOString(),
        rewardsEtb: r.rewards.reduce((s, x) => s + toEtbNumber(x.amount), 0),
      })),
      totalRewardsEtb: rows
        .flatMap((r) => r.rewards)
        .reduce((s, x) => s + toEtbNumber(x.amount), 0),
    };
  }

  /** Called from telegram auth when startParam=ref_<userId> */
  async linkReferral(referredUserId: string, startParam?: string) {
    if (!startParam?.startsWith('ref_')) return;
    const referrerUserId = startParam.slice(4);
    if (!referrerUserId || referrerUserId === referredUserId) return;

    const referrer = await this.prisma.user.findUnique({
      where: { id: referrerUserId },
    });
    if (!referrer) return;

    await this.prisma.referral.upsert({
      where: { referredUserId },
      create: { referrerUserId, referredUserId },
      update: {},
    });
    await this.prisma.user.update({
      where: { id: referredUserId },
      data: { referredByUserId: referrerUserId },
    });
  }
}
