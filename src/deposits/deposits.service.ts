import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DepositStatus,
  DepositVerificationOutcome,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { SettingsService } from '../settings/settings.service';
import { etbDecimal, toEtbNumber } from '../common/utils/money';
import { DOMAIN_EVENTS } from '../common/events/event-names';
import {
  PAYMENT_VERIFICATION_PROVIDER,
  PaymentVerificationProvider,
  PaymentVerificationResult,
} from './verification/payment-verification.provider';
import { providerFamilyForMethod } from './verification/receipt-matcher';

const DEPOSIT_MIN_ETB = 20;
/** Hidden test amount — accepted for live verification trials. */
const DEPOSIT_TEST_ETB = 2;

function isAllowedDepositAmount(amountEtb: number): boolean {
  return (
    Number.isFinite(amountEtb) &&
    (amountEtb === DEPOSIT_TEST_ETB || amountEtb >= DEPOSIT_MIN_ETB)
  );
}

@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
    private readonly settings: SettingsService,
    private readonly events: EventEmitter2,
    @Inject(PAYMENT_VERIFICATION_PROVIDER)
    private readonly verifier: PaymentVerificationProvider,
  ) {}

  async submit(
    userId: string,
    input: {
      amountEtb: number;
      method: PaymentMethod;
      mediaId?: string;
      externalReference?: string;
    },
  ) {
    if (!isAllowedDepositAmount(input.amountEtb)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Minimum deposit is ${DEPOSIT_MIN_ETB} ETB`,
      });
    }

    const externalReference = input.externalReference?.trim() || undefined;
    const mediaId = input.mediaId?.trim() || undefined;

    if (!externalReference && !mediaId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Provide a transaction ID/URL and/or a receipt screenshot',
      });
    }

    let screenshotUrl: string | undefined;
    if (mediaId) {
      const media = await this.prisma.media.findUnique({
        where: { id: mediaId },
      });
      if (!media || media.uploadedById !== userId) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Invalid media for deposit',
        });
      }
      screenshotUrl = media.url;
    }

    const expectedReceiver = await this.resolvePayToAccount(input.method);

    const deposit = await this.prisma.deposit.create({
      data: {
        userId,
        amount: etbDecimal(input.amountEtb),
        method: input.method,
        mediaId: mediaId ?? null,
        externalReference: externalReference ?? null,
        status: DepositStatus.PENDING,
        verificationOutcome: DepositVerificationOutcome.PENDING,
      },
      include: { media: true, user: true },
    });

    const verification = await this.verifier.verify({
      depositId: deposit.id,
      method: input.method,
      claimedAmount: input.amountEtb,
      expectedReceiver: expectedReceiver ?? '',
      externalReference,
      screenshotUrl,
    });

    // Fast duplicate reject before credit path
    if (
      verification.normalizedReference &&
      verification.providerFamily &&
      (await this.isReceiptAlreadyUsed(
        verification.providerFamily,
        verification.normalizedReference,
      ))
    ) {
      const rejected = await this.prisma.deposit.update({
        where: { id: deposit.id },
        data: {
          status: DepositStatus.REJECTED,
          verificationOutcome: DepositVerificationOutcome.REJECTED_DUPLICATE,
          rejectionReason: 'This transaction was already used for a deposit',
          normalizedBankReference: verification.normalizedReference,
          verifiedAmount:
            verification.extractedAmount !== undefined
              ? etbDecimal(verification.extractedAmount)
              : null,
          verifiedProviderSource: verification.providerSource ?? null,
          linksRequestId: verification.linksRequestId ?? null,
          verificationProviderResponse: verification as object,
          reviewedAt: new Date(),
        },
        include: { media: true, user: true },
      });

      this.events.emit(DOMAIN_EVENTS.DEPOSIT_REJECTED, {
        depositId: rejected.id,
        userId,
        reason: rejected.rejectionReason,
        adminId: 'system',
      });

      return this.toUserDepositDto(rejected);
    }

    if (verification.status === 'AUTO_APPROVED') {
      try {
        const approved = await this.autoApprove(deposit.id, verification);
        this.events.emit(DOMAIN_EVENTS.DEPOSIT_APPROVED, {
          depositId: approved.id,
          userId: approved.userId,
          amountEtb: toEtbNumber(approved.amount),
          adminId: 'system',
        });
        return this.toUserDepositDto(approved);
      } catch (err) {
        this.logger.warn(
          `Auto-approve failed for ${deposit.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
        // Fall through to manual if unique constraint or race
      }
    }

    const outcome =
      verification.status === 'REJECTED_DUPLICATE'
        ? DepositVerificationOutcome.REJECTED_DUPLICATE
        : DepositVerificationOutcome.NEEDS_MANUAL_REVIEW;

    const updated = await this.prisma.deposit.update({
      where: { id: deposit.id },
      data: {
        verificationOutcome: outcome,
        normalizedBankReference: verification.normalizedReference ?? null,
        verifiedAmount:
          verification.extractedAmount !== undefined
            ? etbDecimal(verification.extractedAmount)
            : null,
        verifiedProviderSource: verification.providerSource ?? null,
        linksRequestId: verification.linksRequestId ?? null,
        verificationProviderResponse: verification as object,
        ...(outcome === DepositVerificationOutcome.REJECTED_DUPLICATE
          ? {
              status: DepositStatus.REJECTED,
              rejectionReason:
                verification.reason ||
                'This transaction was already used for a deposit',
              reviewedAt: new Date(),
            }
          : {}),
      },
      include: { media: true, user: true },
    });

    if (updated.status === DepositStatus.REJECTED) {
      this.events.emit(DOMAIN_EVENTS.DEPOSIT_REJECTED, {
        depositId: updated.id,
        userId,
        reason: updated.rejectionReason || verification.reason,
        adminId: 'system',
      });
    } else {
      this.events.emit(DOMAIN_EVENTS.DEPOSIT_SUBMITTED, {
        depositId: updated.id,
        userId,
        amountEtb: input.amountEtb,
      });
    }

    return this.toUserDepositDto(updated);
  }

  private async autoApprove(
    depositId: string,
    verification: PaymentVerificationResult,
  ) {
    if (
      !verification.normalizedReference ||
      !verification.providerFamily ||
      verification.extractedAmount === undefined ||
      !verification.receiptSnapshot
    ) {
      throw new Error('Incomplete verification for auto-approve');
    }

    const deposit = await this.prisma.$transaction(async (tx) => {
      // Claim receipt uniqueness first — prevents double credit across deposits
      await tx.verifiedPaymentReceipt.create({
        data: {
          providerFamily: verification.providerFamily!,
          normalizedReference: verification.normalizedReference!,
          depositId,
          amountEtb: etbDecimal(verification.extractedAmount!),
          receiverMatched: verification.receiverObserved ?? null,
          receiptSnapshot: verification.receiptSnapshot as Prisma.InputJsonValue,
        },
      });

      const claimed = await tx.deposit.updateMany({
        where: { id: depositId, status: DepositStatus.PENDING },
        data: {
          status: DepositStatus.APPROVED,
          verificationOutcome: DepositVerificationOutcome.AUTO_APPROVED,
          reviewedAt: new Date(),
          normalizedBankReference: verification.normalizedReference,
          verifiedAmount: etbDecimal(verification.extractedAmount!),
          verifiedProviderSource: verification.providerSource ?? null,
          linksRequestId: verification.linksRequestId ?? null,
          verificationProviderResponse: verification as object,
        },
      });

      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Deposit is not pending',
        });
      }

      return tx.deposit.findUniqueOrThrow({
        where: { id: depositId },
        include: { media: true, user: true },
      });
    });

    await this.wallets.creditDeposit(
      deposit.userId,
      deposit.id,
      toEtbNumber(deposit.amount),
    );

    return deposit;
  }

  private async isReceiptAlreadyUsed(
    providerFamily: string,
    normalizedReference: string,
  ) {
    const existing = await this.prisma.verifiedPaymentReceipt.findUnique({
      where: {
        providerFamily_normalizedReference: {
          providerFamily,
          normalizedReference,
        },
      },
    });
    return Boolean(existing);
  }

  private async resolvePayToAccount(
    method: PaymentMethod,
  ): Promise<string | undefined> {
    const settings = await this.settings.get();
    const account = settings.paymentAccounts.find(
      (a) => a.method === method && a.enabled && a.value?.trim(),
    );
    return account?.value?.trim();
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
        include: { media: true, user: true, verifiedReceipt: true },
        orderBy: [{ createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const items =
      opts.status === DepositStatus.PENDING || !opts.status
        ? [...rows].sort((a, b) => {
            if (
              a.status === DepositStatus.PENDING &&
              b.status !== DepositStatus.PENDING
            )
              return -1;
            if (
              b.status === DepositStatus.PENDING &&
              a.status !== DepositStatus.PENDING
            )
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
      include: { media: true, user: true, verifiedReceipt: true },
    });
    if (!deposit) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Deposit not found',
      });
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

    const family = providerFamilyForMethod(deposit.method);
    const normalizedRef = deposit.normalizedBankReference;

    try {
      await this.prisma.$transaction(async (tx) => {
        if (normalizedRef) {
          const existing = await tx.verifiedPaymentReceipt.findUnique({
            where: {
              providerFamily_normalizedReference: {
                providerFamily: family,
                normalizedReference: normalizedRef,
              },
            },
          });
          if (existing && existing.depositId !== depositId) {
            throw new ConflictException({
              code: 'DUPLICATE_RECEIPT',
              message:
                'This bank transaction was already credited on another deposit',
            });
          }
          if (!existing) {
            await tx.verifiedPaymentReceipt.create({
              data: {
                providerFamily: family,
                normalizedReference: normalizedRef,
                depositId,
                amountEtb: deposit.amount,
                receiverMatched: null,
                receiptSnapshot: (deposit.verificationProviderResponse as object) || {
                  source: 'admin_manual',
                },
              },
            });
          }
        }

        const claimed = await tx.deposit.updateMany({
          where: { id: depositId, status: DepositStatus.PENDING },
          data: {
            status: DepositStatus.APPROVED,
            reviewedByAdminId: adminId,
            reviewedAt: new Date(),
          },
        });

        if (claimed.count === 0) {
          throw new ConflictException({
            code: 'CONFLICT',
            message: 'Deposit is not pending',
          });
        }
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'DUPLICATE_RECEIPT',
          message:
            'This bank transaction was already credited on another deposit',
        });
      }
      throw err;
    }

    await this.wallets.creditDeposit(
      deposit.userId,
      deposit.id,
      toEtbNumber(deposit.amount),
    );

    const updated = await this.prisma.deposit.findUniqueOrThrow({
      where: { id: depositId },
      include: { media: true, user: true, verifiedReceipt: true },
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
      include: { media: true, user: true, verifiedReceipt: true },
    });
    if (!deposit) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Deposit not found',
      });
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
      include: { media: true, user: true, verifiedReceipt: true },
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
    verificationOutcome: DepositVerificationOutcome;
    media: { url: string } | null;
    externalReference: string | null;
    createdAt: Date;
    reviewedAt: Date | null;
    rejectionReason: string | null;
  }) {
    const autoApproved =
      d.status === DepositStatus.APPROVED &&
      d.verificationOutcome === DepositVerificationOutcome.AUTO_APPROVED;

    return {
      id: d.id,
      amountEtb: toEtbNumber(d.amount),
      method: d.method,
      status: d.status,
      verificationOutcome: d.verificationOutcome,
      screenshotUrl: d.media?.url,
      externalReference: d.externalReference ?? undefined,
      createdAt: d.createdAt.toISOString(),
      reviewedAt: d.reviewedAt?.toISOString(),
      rejectionReason: d.rejectionReason ?? undefined,
      autoApproved,
      message: userFacingMessage(d.status, d.verificationOutcome, autoApproved),
    };
  }

  toAdminDepositDto(d: {
    id: string;
    userId: string;
    amount: { toString(): string };
    method: PaymentMethod;
    status: DepositStatus;
    verificationOutcome: DepositVerificationOutcome;
    media: { url: string } | null;
    externalReference: string | null;
    normalizedBankReference: string | null;
    verifiedAmount: { toString(): string } | null;
    verifiedProviderSource: string | null;
    verificationProviderResponse: unknown;
    createdAt: Date;
    reviewedAt: Date | null;
    rejectionReason: string | null;
    user: { displayName: string };
  }) {
    const verification = d.verificationProviderResponse as
      | PaymentVerificationResult
      | null;

    return {
      id: d.id,
      userId: d.userId,
      userName: d.user.displayName,
      amount: toEtbNumber(d.amount),
      method: d.method,
      status: d.status,
      verificationOutcome: d.verificationOutcome,
      screenshotUrl: d.media?.url,
      externalReference: d.externalReference ?? undefined,
      bankReference: d.normalizedBankReference ?? undefined,
      verifiedAmount:
        d.verifiedAmount !== null ? toEtbNumber(d.verifiedAmount) : undefined,
      verifiedProviderSource: d.verifiedProviderSource ?? undefined,
      verificationReason: verification?.reason,
      accountMatch: verification?.accountMatch,
      createdAt: d.createdAt.toISOString(),
      reviewedAt: d.reviewedAt?.toISOString(),
      rejectionReason: d.rejectionReason ?? undefined,
    };
  }
}

function userFacingMessage(
  status: DepositStatus,
  outcome: DepositVerificationOutcome,
  autoApproved: boolean,
): string {
  if (autoApproved || status === DepositStatus.APPROVED) {
    return 'Payment verified. Your wallet has been credited.';
  }
  if (status === DepositStatus.REJECTED) {
    if (outcome === DepositVerificationOutcome.REJECTED_DUPLICATE) {
      return 'This transaction was already used. Contact support if this is a mistake.';
    }
    return 'Deposit was rejected.';
  }
  return 'Your deposit is waiting for approver review. You will be notified when it is approved.';
}
