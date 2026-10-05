import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditActorType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminActionPayload,
  DOMAIN_EVENTS,
  DepositApprovedPayload,
  DepositRejectedPayload,
  UserBannedPayload,
  WalletChangedPayload,
} from '../common/events/event-names';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async write(input: {
    actorType: AuditActorType;
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
  }) {
    return this.prisma.auditLog.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: (input.before as object) ?? undefined,
        after: (input.after as object) ?? undefined,
        reason: input.reason,
      },
    });
  }

  @OnEvent(DOMAIN_EVENTS.ADMIN_ACTION_PERFORMED)
  async onAdminAction(payload: AdminActionPayload) {
    await this.write({
      actorType: AuditActorType.ADMIN,
      actorId: payload.actorId,
      action: payload.action,
      entityType: payload.entityType,
      entityId: payload.entityId,
      before: payload.before,
      after: payload.after,
      reason: payload.reason,
    });
  }

  @OnEvent(DOMAIN_EVENTS.DEPOSIT_APPROVED)
  async onDepositApproved(payload: DepositApprovedPayload) {
    await this.write({
      actorType: AuditActorType.ADMIN,
      actorId: payload.adminId,
      action: 'deposit.approve',
      entityType: 'deposit',
      entityId: payload.depositId,
      after: payload,
    });
  }

  @OnEvent(DOMAIN_EVENTS.DEPOSIT_REJECTED)
  async onDepositRejected(payload: DepositRejectedPayload) {
    await this.write({
      actorType: AuditActorType.ADMIN,
      actorId: payload.adminId,
      action: 'deposit.reject',
      entityType: 'deposit',
      entityId: payload.depositId,
      after: payload,
      reason: payload.reason,
    });
  }

  @OnEvent(DOMAIN_EVENTS.USER_BANNED)
  async onUserBanned(payload: UserBannedPayload) {
    await this.write({
      actorType: AuditActorType.SYSTEM,
      actorId: 'system',
      action: payload.banned ? 'user.ban' : 'user.unban',
      entityType: 'user',
      entityId: payload.userId,
      after: payload,
      reason: payload.reason,
    });
  }

  @OnEvent(DOMAIN_EVENTS.WALLET_ADMIN_ADJUSTED)
  async onWalletAdjusted(payload: WalletChangedPayload) {
    await this.write({
      actorType: AuditActorType.SYSTEM,
      actorId: 'system',
      action: 'wallet.admin_adjusted',
      entityType: 'wallet',
      entityId: payload.walletId,
      after: payload,
    });
  }
}
