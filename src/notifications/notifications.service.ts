import { Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DOMAIN_EVENTS,
  DepositApprovedPayload,
  DepositRejectedPayload,
  DepositSubmittedPayload,
  TicketPurchasedPayload,
  TicketReservationExpiredPayload,
  UserBannedPayload,
  UserRegisteredPayload,
  WalletChangedPayload,
  WinnerSelectedPayload,
  WinnerPayoutUpdatedPayload,
} from '../common/events/event-names';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createInApp(input: {
    userId?: string;
    adminId?: string;
    type: string;
    title: string;
    body: string;
    kind?: string;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        adminId: input.adminId,
        channel: NotificationChannel.IN_APP,
        type: input.type,
        payload: {
          title: input.title,
          body: input.body,
          kind: input.kind || 'system',
        },
        status: NotificationStatus.SENT,
      },
    });
  }

  async listForUser(userId: string, unreadOnly = false) {
    const rows = await this.prisma.notification.findMany({
      where: {
        userId,
        channel: NotificationChannel.IN_APP,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return rows.map((n) => {
      const payload = n.payload as { title?: string; body?: string; kind?: string };
      return {
        id: n.id,
        title: payload.title || n.type,
        body: payload.body || '',
        kind: payload.kind || 'system',
        unread: !n.readAt,
        createdAt: n.createdAt.toISOString(),
      };
    });
  }

  async markRead(userId: string, id: string) {
    const n = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!n) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Notification not found' });
    }
    await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  @OnEvent(DOMAIN_EVENTS.USER_REGISTERED)
  async onUserRegistered(payload: UserRegisteredPayload) {
    await this.createInApp({
      userId: payload.userId,
      type: 'user.registered',
      title: 'Welcome',
      body: 'Your account is ready. Add a phone number and deposit to start.',
      kind: 'system',
    });
  }

  @OnEvent(DOMAIN_EVENTS.USER_BANNED)
  async onUserBanned(payload: UserBannedPayload) {
    if (!payload.banned) return;
    await this.createInApp({
      userId: payload.userId,
      type: 'user.banned',
      title: 'Account banned',
      body: payload.reason || 'Your account has been banned.',
      kind: 'system',
    });
  }

  @OnEvent(DOMAIN_EVENTS.DEPOSIT_SUBMITTED)
  async onDepositSubmitted(payload: DepositSubmittedPayload) {
    await this.createInApp({
      userId: payload.userId,
      type: 'deposit.submitted',
      title: 'Deposit pending approval',
      body: `Your deposit of ${payload.amountEtb} ETB is waiting for approver review. You will be notified when it is approved.`,
      kind: 'deposit',
    });
  }

  @OnEvent(DOMAIN_EVENTS.DEPOSIT_APPROVED)
  async onDepositApproved(payload: DepositApprovedPayload) {
    const instant = payload.adminId === 'system';
    await this.createInApp({
      userId: payload.userId,
      type: 'deposit.approved',
      title: instant ? 'Deposit verified' : 'Deposit approved',
      body: instant
        ? `${payload.amountEtb} ETB verified and credited to your wallet.`
        : `${payload.amountEtb} ETB was credited to your wallet.`,
      kind: 'deposit',
    });
  }

  @OnEvent(DOMAIN_EVENTS.DEPOSIT_REJECTED)
  async onDepositRejected(payload: DepositRejectedPayload) {
    await this.createInApp({
      userId: payload.userId,
      type: 'deposit.rejected',
      title: 'Deposit rejected',
      body: payload.reason,
      kind: 'deposit',
    });
  }

  @OnEvent(DOMAIN_EVENTS.WALLET_ADMIN_ADJUSTED)
  async onWalletAdjusted(payload: WalletChangedPayload) {
    await this.createInApp({
      userId: payload.userId,
      type: 'wallet.admin_adjusted',
      title: 'Wallet adjusted',
      body: `Your balance changed by ${payload.amountEtb} ETB.`,
      kind: 'system',
    });
  }

  @OnEvent(DOMAIN_EVENTS.TICKET_PURCHASED)
  async onPurchased(payload: TicketPurchasedPayload) {
    await this.createInApp({
      userId: payload.userId,
      type: 'ticket.purchased',
      title: 'Tickets purchased',
      body: `You bought ${payload.ticketNumbers.length} ticket(s) for ${payload.totalAmountEtb} ETB.`,
      kind: 'ticket',
    });
  }

  @OnEvent(DOMAIN_EVENTS.TICKET_RESERVATION_EXPIRED)
  async onReservationExpired(payload: TicketReservationExpiredPayload) {
    await this.createInApp({
      userId: payload.userId,
      type: 'ticket.reservation.expired',
      title: 'Reservation expired',
      body: `Your hold on ticket(s) ${payload.tickets.map((t) => `#${t.ticketNumber}`).join(', ')} expired.`,
      kind: 'ticket',
    });
  }

  @OnEvent(DOMAIN_EVENTS.WINNER_SELECTED)
  async onWinner(payload: WinnerSelectedPayload) {
    await this.createInApp({
      userId: payload.userId,
      type: 'winner.selected',
      title: 'You won!',
      body: `Ticket #${payload.ticketNumber} won place ${payload.place}.`,
      kind: 'winner',
    });
  }

  @OnEvent(DOMAIN_EVENTS.WINNER_PAYOUT_UPDATED)
  async onPayout(payload: WinnerPayoutUpdatedPayload) {
    await this.createInApp({
      userId: payload.userId,
      type: 'winner.payout_updated',
      title: 'Prize fulfillment update',
      body: `Your prize status is now ${payload.status}.`,
      kind: 'winner',
    });
  }
}
