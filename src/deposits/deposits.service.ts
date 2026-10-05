import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DepositStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { etbDecimal, toEtbNumber } from '../common/utils/money';
import { DOMAIN_EVENTS } from '../common/events/event-names';
import {
  PAYMENT_VERIFICATION_PROVIDER,
  PaymentVerificationProvider,
} from './verification/payment-verification.provider';

const DEPOSIT_MIN_ETB = 50;

@Injectable()
export class DepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
    private readonly events: EventEmitter2,
    @Inject(PAYMENT_VERIFICATION_PROVIDER)
    private readonly verifier: PaymentVerificationProvider,
  ) {}

  async submit(
    userId: string,
    input: { amountEtb: number; method: PaymentMethod; mediaId: string },
  ) {
    if (!Number.isFinite(input.amountEtb) || input.amountEtb < DEPOSIT_MIN_ETB) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Minimum deposit is ${DEPOSIT_MIN_ETB} ETB`,
      });
    }

    const media = await this.prisma.media.findUnique({
      where: { id: input.mediaId },
    });
    if (!media || media.uploadedById !== userId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid media for deposit',
      });
    }

    const deposit = await this.prisma.deposit.create({
      data: {
        userId,
        amount: etbDecimal(input.amountEtb),
        method: input.method,
        mediaId: input.mediaId,
        status: DepositStatus.PENDING,
      },
      include: { media: true, user: true },
    });

    const verification = await this.verifier.verify({
      depositId: deposit.id,
      screenshotUrl: media.url,
      claimedAmount: input.amountEtb,
    });

    const updated = await this.prisma.deposit.update({
      where: { id: deposit.id },
      data: { verificationProviderResponse: verification as object },
      include: { media: true, user: true },
    });

    this.events.emit(DOMAIN_EVENTS.DEPOSIT_SUBMITTED, {
      depositId: updated.id,
      userId,
      amountEtb: input.amountEtb,
    });

    return this.toUserDepositDto(updated);
  }

  async listMine(userId: string) {
    const rows = await this.prisma.deposit.findMany({
      where: { userId },
      include: { media: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((d) => this.toUserDepositDto(d));
  }

  async listAdmin(opts: {
    status?: DepositStatus;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 20));
    const where = opts.status ? { status: opts.status } : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.deposit.count({ where }),
      this.prisma.deposit.findMany({
        where,
        include: { media: true, user: true },
        orderBy: [
          { status: 'asc' }, // PENDING first alphabetically... better custom
          { createdAt: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // Prefer PENDING oldest-first when no status filter
    const items =
      opts.status === DepositStatus.PENDING || !opts.status
        ? [...rows].sort((a, b) => {
            if (a.status === DepositStatus.PENDING && b.status !== DepositStatus.PENDING)
              return -1;
            if (b.status === DepositStatus.PENDING && a.status !== DepositStatus.PENDING)
              return 1;
            return a.createdAt.getTime() - b.createdAt.getTime();
          })
        : rows;

    return {
      items: items.map((d) => this.toAdminDepositDto(d)),
      total,
      page,
      pageSize,
    };
  }

  async approve(depositId: string, adminId: string) {
    const deposit = await this.prisma.deposit.findUnique({
      where: { id: depositId },
      include: { media: true, user: true },
    });
    if (!deposit) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Deposit not found' });
    }

    if (deposit.status === DepositStatus.APPROVED) {
      return this.toAdminDepositDto(deposit);
    }
    if (deposit.status !== DepositStatus.PENDING) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Deposit is not pending',
      });
    }

    // Atomic claim: only one concurrent approver wins the PENDING → APPROVED flip
    const claimed = await this.prisma.deposit.updateMany({
      where: { id: depositId, status: DepositStatus.PENDING },
      data: {
        status: DepositStatus.APPROVED,
        reviewedByAdminId: adminId,
        reviewedAt: new Date(),
      },
    });

    if (claimed.count === 0) {
      const again = await this.prisma.deposit.findUniqueOrThrow({
        where: { id: depositId },
        include: { media: true, user: true },
      });
      return this.toAdminDepositDto(again);
    }

    await this.wallets.creditDeposit(
      deposit.userId,
      deposit.id,
      toEtbNumber(deposit.amount),
    );

    const updated = await this.prisma.deposit.findUniqueOrThrow({
      where: { id: depositId },
      include: { media: true, user: true },
    });

    this.events.emit(DOMAIN_EVENTS.DEPOSIT_APPROVED, {
      depositId: updated.id,
      userId: updated.userId,
      amountEtb: toEtbNumber(updated.amount),
      adminId,
    });

    return this.toAdminDepositDto(updated);
  }

  async reject(depositId: string, adminId: string, reason: string) {
    if (!reason?.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Rejection reason is required',
      });
    }

    const deposit = await this.prisma.deposit.findUnique({
      where: { id: depositId },
      include: { media: true, user: true },
    });
    if (!deposit) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Deposit not found' });
    }
    if (deposit.status !== DepositStatus.PENDING) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Deposit is not pending',
      });
    }

    const claimed = await this.prisma.deposit.updateMany({
      where: { id: depositId, status: DepositStatus.PENDING },
      data: {
        status: DepositStatus.REJECTED,
        reviewedByAdminId: adminId,
        reviewedAt: new Date(),
        rejectionReason: reason.trim(),
      },
    });

    if (claimed.count === 0) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Deposit is not pending',
      });
    }

    const updated = await this.prisma.deposit.findUniqueOrThrow({
      where: { id: depositId },
      include: { media: true, user: true },
    });

    this.events.emit(DOMAIN_EVENTS.DEPOSIT_REJECTED, {
      depositId: updated.id,
      userId: updated.userId,
      reason: reason.trim(),
      adminId,
    });

    return this.toAdminDepositDto(updated);
  }

  toUserDepositDto(d: {
    id: string;
    amount: { toString(): string };
    method: PaymentMethod;
    status: DepositStatus;
    media: { url: string };
    createdAt: Date;
    reviewedAt: Date | null;
    rejectionReason: string | null;
  }) {
    return {
      id: d.id,
      amountEtb: toEtbNumber(d.amount),
      method: d.method,
      status: d.status,
      screenshotUrl: d.media.url,
      createdAt: d.createdAt.toISOString(),
      reviewedAt: d.reviewedAt?.toISOString(),
      rejectionReason: d.rejectionReason ?? undefined,
    };
  }

  toAdminDepositDto(d: {
    id: string;
    userId: string;
    amount: { toString(): string };
    method: PaymentMethod;
    status: DepositStatus;
    media: { url: string };
    createdAt: Date;
    reviewedAt: Date | null;
    rejectionReason: string | null;
    user: { displayName: string };
  }) {
    return {
      id: d.id,
      userId: d.userId,
      userName: d.user.displayName,
      amount: toEtbNumber(d.amount),
      method: d.method,
      status: d.status,
      screenshotUrl: d.media.url,
      createdAt: d.createdAt.toISOString(),
      reviewedAt: d.reviewedAt?.toISOString(),
      rejectionReason: d.rejectionReason ?? undefined,
    };
  }
}
