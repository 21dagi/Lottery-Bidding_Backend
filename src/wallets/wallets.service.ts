import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WalletTxType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { etbDecimal, toEtbNumber } from '../common/utils/money';
import { DOMAIN_EVENTS } from '../common/events/event-names';

@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async getWalletForUser(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Wallet not found' });
    }
    return {
      balanceEtb: toEtbNumber(wallet.cachedBalance),
      id: wallet.id,
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  async listTransactions(
    userId: string,
    opts: { type?: string; page?: number; pageSize?: number },
  ) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Wallet not found' });
    }
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 20));

    const typeMap: Record<string, WalletTxType> = {
      deposit: WalletTxType.DEPOSIT,
      DEPOSIT: WalletTxType.DEPOSIT,
      purchase: WalletTxType.PURCHASE,
      PURCHASE: WalletTxType.PURCHASE,
      reward: WalletTxType.REFERRAL,
      REFERRAL: WalletTxType.REFERRAL,
      adjustment: WalletTxType.ADMIN_ADJUST,
      ADMIN_ADJUST: WalletTxType.ADMIN_ADJUST,
    };

    const where = {
      walletId: wallet.id,
      ...(opts.type && typeMap[opts.type]
        ? { type: typeMap[opts.type] }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.walletTransaction.count({ where }),
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((tx) => this.toUserTxDto(tx)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Append-only ledger credit/debit inside a Prisma interactive transaction.
   * Updates cachedBalance in the same transaction.
   */
  async appendLedger(
    txClient: PrismaService | Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    input: {
      userId: string;
      type: WalletTxType;
      amountEtb: number;
      referenceType?: string;
      referenceId?: string;
      reason?: string;
      createdByAdminId?: string;
    },
  ) {
    const client = txClient as PrismaService;
    const wallet = await client.wallet.findUnique({
      where: { userId: input.userId },
    });
    if (!wallet) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Wallet not found' });
    }

    const amount = etbDecimal(input.amountEtb);
    const balanceAfter = etbDecimal(toEtbNumber(wallet.cachedBalance)).plus(amount);

    const ledger = await client.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: input.type,
        amount,
        balanceAfter,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reason: input.reason,
        createdByAdminId: input.createdByAdminId,
      },
    });

    const updated = await client.wallet.update({
      where: { id: wallet.id },
      data: { cachedBalance: balanceAfter },
    });

    return {
      transaction: ledger,
      wallet: updated,
      amountEtb: toEtbNumber(amount),
      balanceAfter: toEtbNumber(balanceAfter),
    };
  }

  async creditDeposit(userId: string, depositId: string, amountEtb: number) {
    // Idempotency: skip if a DEPOSIT ledger row already references this deposit
    const existing = await this.prisma.walletTransaction.findFirst({
      where: {
        type: WalletTxType.DEPOSIT,
        referenceType: 'deposit',
        referenceId: depositId,
      },
    });
    if (existing) {
      const wallet = await this.prisma.wallet.findUniqueOrThrow({
        where: { userId },
      });
      return {
        transaction: existing,
        wallet,
        amountEtb: 0,
        balanceAfter: toEtbNumber(wallet.cachedBalance),
        duplicated: true,
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      return this.appendLedger(tx as unknown as PrismaService, {
        userId,
        type: WalletTxType.DEPOSIT,
        amountEtb,
        referenceType: 'deposit',
        referenceId: depositId,
      });
    });

    this.events.emit(DOMAIN_EVENTS.WALLET_CREDITED, {
      walletId: result.wallet.id,
      userId,
      amountEtb: result.amountEtb,
      balanceAfter: result.balanceAfter,
      transactionId: result.transaction.id,
      type: WalletTxType.DEPOSIT,
    });

    return { ...result, duplicated: false };
  }

  async adminAdjust(
    userId: string,
    amountEtb: number,
    reason: string,
    adminId: string,
  ) {
    if (!reason?.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Adjustment reason is required',
      });
    }
    if (!Number.isFinite(amountEtb) || amountEtb === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'amount must be a non-zero number',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      return this.appendLedger(tx as unknown as PrismaService, {
        userId,
        type: WalletTxType.ADMIN_ADJUST,
        amountEtb,
        reason: reason.trim(),
        createdByAdminId: adminId,
        referenceType: 'admin_adjust',
      });
    });

    const event =
      amountEtb > 0
        ? DOMAIN_EVENTS.WALLET_CREDITED
        : DOMAIN_EVENTS.WALLET_DEBITED;
    this.events.emit(event, {
      walletId: result.wallet.id,
      userId,
      amountEtb: result.amountEtb,
      balanceAfter: result.balanceAfter,
      transactionId: result.transaction.id,
      type: WalletTxType.ADMIN_ADJUST,
    });
    this.events.emit(DOMAIN_EVENTS.WALLET_ADMIN_ADJUSTED, {
      walletId: result.wallet.id,
      userId,
      amountEtb: result.amountEtb,
      balanceAfter: result.balanceAfter,
      transactionId: result.transaction.id,
      type: WalletTxType.ADMIN_ADJUST,
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      id: result.wallet.id,
      userId,
      userName: user.displayName,
      balance: result.balanceAfter,
      updatedAt: result.wallet.updatedAt.toISOString(),
    };
  }

  async listAdmin(opts: { page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 20));
    const [total, wallets] = await this.prisma.$transaction([
      this.prisma.wallet.count(),
      this.prisma.wallet.findMany({
        include: { user: true },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: wallets.map((w) => ({
        id: w.id,
        userId: w.userId,
        userName: w.user.displayName,
        balance: toEtbNumber(w.cachedBalance),
        updatedAt: w.updatedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  private toUserTxDto(tx: {
    id: string;
    type: WalletTxType;
    amount: { toString(): string };
    reason: string | null;
    createdAt: Date;
    referenceType: string | null;
  }) {
    const typeMap: Record<WalletTxType, string> = {
      DEPOSIT: 'deposit',
      PURCHASE: 'purchase',
      REFERRAL: 'reward',
      ADMIN_ADJUST: 'adjustment',
    };
    const amountEtb = toEtbNumber(tx.amount);
    return {
      id: tx.id,
      type: typeMap[tx.type],
      title: this.titleFor(tx.type),
      meta: tx.reason || tx.referenceType || '',
      amountEtb,
      status: amountEtb >= 0 ? 'credited' : 'completed',
      createdAt: tx.createdAt.toISOString(),
    };
  }

  private titleFor(type: WalletTxType) {
    switch (type) {
      case 'DEPOSIT':
        return 'Deposit';
      case 'PURCHASE':
        return 'Ticket purchase';
      case 'REFERRAL':
        return 'Referral reward';
      case 'ADMIN_ADJUST':
        return 'Balance adjustment';
      default:
        return 'Transaction';
    }
  }
}
