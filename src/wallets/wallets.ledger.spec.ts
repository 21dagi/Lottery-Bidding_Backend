import {
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WalletTxType, DepositStatus } from '@prisma/client';
import { WalletsService } from '../wallets/wallets.service';
import { DepositsService } from '../deposits/deposits.service';
import { etbDecimal } from '../common/utils/money';

/**
 * Lightweight in-memory fakes for ledger math / idempotency rules.
 * Full DB e2e lives in test/app.e2e-spec.ts when Postgres is available.
 */
describe('WalletsService ledger rules (unit)', () => {
  it('rejects admin adjust without reason', async () => {
    const prisma = {
      $transaction: jest.fn(),
      wallet: { findUnique: jest.fn() },
    } as unknown as ConstructorParameters<typeof WalletsService>[0];
    const events = { emit: jest.fn() } as unknown as EventEmitter2;
    const service = new WalletsService(prisma, events);

    await expect(
      service.adminAdjust('u1', 10, '', 'admin1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects zero adjust amount', async () => {
    const prisma = {
      $transaction: jest.fn(),
    } as unknown as ConstructorParameters<typeof WalletsService>[0];
    const events = { emit: jest.fn() } as unknown as EventEmitter2;
    const service = new WalletsService(prisma, events);

    await expect(
      service.adminAdjust('u1', 0, 'oops', 'admin1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creditDeposit is idempotent when ledger row exists', async () => {
    const existing = {
      id: 'tx1',
      type: WalletTxType.DEPOSIT,
      amount: etbDecimal(100),
    };
    const prisma = {
      walletTransaction: {
        findFirst: jest.fn().mockResolvedValue(existing),
      },
      wallet: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'w1',
          cachedBalance: etbDecimal(100),
        }),
      },
      $transaction: jest.fn(),
    } as unknown as ConstructorParameters<typeof WalletsService>[0];
    const events = { emit: jest.fn() } as unknown as EventEmitter2;
    const service = new WalletsService(prisma, events);

    const result = await service.creditDeposit('u1', 'dep1', 100);
    expect(result.duplicated).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('DepositsService reject reason', () => {
  it('requires reason on reject', async () => {
    const prisma = {
      deposit: { findUnique: jest.fn() },
    } as unknown as ConstructorParameters<typeof DepositsService>[0];
    const wallets = {} as ConstructorParameters<typeof DepositsService>[1];
    const events = { emit: jest.fn() } as unknown as EventEmitter2;
    const verifier = { verify: jest.fn() };
    const service = new DepositsService(prisma, wallets, events, verifier);

    await expect(service.reject('d1', 'a1', '')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('approve is idempotent when already APPROVED', async () => {
    const deposit = {
      id: 'd1',
      userId: 'u1',
      amount: etbDecimal(50),
      method: 'telebirr',
      status: DepositStatus.APPROVED,
      media: { url: 'http://x/a.png' },
      user: { displayName: 'Ada' },
      createdAt: new Date(),
      reviewedAt: new Date(),
      rejectionReason: null,
    };
    const prisma = {
      deposit: { findUnique: jest.fn().mockResolvedValue(deposit) },
    } as unknown as ConstructorParameters<typeof DepositsService>[0];
    const wallets = {
      creditDeposit: jest.fn(),
    } as unknown as ConstructorParameters<typeof DepositsService>[1];
    const events = { emit: jest.fn() } as unknown as EventEmitter2;
    const verifier = { verify: jest.fn() };
    const service = new DepositsService(prisma, wallets, events, verifier);

    const result = await service.approve('d1', 'admin');
    expect(result.status).toBe('APPROVED');
    expect(wallets.creditDeposit).not.toHaveBeenCalled();
  });
});
