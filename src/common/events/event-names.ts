export const DOMAIN_EVENTS = {
  // Job 1
  USER_REGISTERED: 'user.registered',
  USER_BANNED: 'user.banned',
  DEPOSIT_SUBMITTED: 'deposit.submitted',
  DEPOSIT_APPROVED: 'deposit.approved',
  DEPOSIT_REJECTED: 'deposit.rejected',
  WALLET_CREDITED: 'wallet.credited',
  WALLET_DEBITED: 'wallet.debited',
  WALLET_ADMIN_ADJUSTED: 'wallet.admin_adjusted',
  ADMIN_ACTION_PERFORMED: 'admin.action_performed',
  // Job 2
  LOTTERY_PUBLISHED: 'lottery.published',
  LOTTERY_LOCKED: 'lottery.locked',
  LOTTERY_CANCELLED: 'lottery.cancelled',
  LOTTERY_COMPLETED: 'lottery.completed',
  TICKET_RESERVED: 'ticket.reserved',
  TICKET_RESERVATION_EXPIRED: 'ticket.reservation.expired',
  TICKET_PURCHASED: 'ticket.purchased',
  DRAW_COMMITTED: 'draw.committed',
  DRAW_COMPLETED: 'draw.completed',
  WINNER_SELECTED: 'winner.selected',
  WINNER_PAYOUT_UPDATED: 'winner.payout_updated',
  REFERRAL_REWARD_CREDITED: 'referral.reward_credited',
} as const;

export type DomainEventName =
  (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

export interface UserRegisteredPayload {
  userId: string;
  telegramId: string;
}

export interface UserBannedPayload {
  userId: string;
  reason: string;
  banned: boolean;
}

export interface DepositSubmittedPayload {
  depositId: string;
  userId: string;
  amountEtb: number;
}

export interface DepositApprovedPayload {
  depositId: string;
  userId: string;
  amountEtb: number;
  adminId: string;
}

export interface DepositRejectedPayload {
  depositId: string;
  userId: string;
  reason: string;
  adminId: string;
}

export interface WalletChangedPayload {
  walletId: string;
  userId: string;
  amountEtb: number;
  balanceAfter: number;
  transactionId: string;
  type: string;
}

export interface AdminActionPayload {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

export interface LotteryLifecyclePayload {
  lotteryId: string;
  adminId?: string;
  title: string;
  status: string;
  reason?: string;
}

export interface TicketReservedPayload {
  lotteryId: string;
  userId: string;
  reservationGroupId: string;
  tickets: { ticketId: string; ticketNumber: number; expiresAt: string }[];
}

export interface TicketReservationExpiredPayload {
  lotteryId: string;
  userId: string;
  tickets: { ticketId: string; ticketNumber: number }[];
}

export interface TicketPurchasedPayload {
  lotteryId: string;
  userId: string;
  purchaseId: string;
  ticketIds: string[];
  ticketNumbers: number[];
  totalAmountEtb: number;
  walletTransactionId: string;
}

export interface DrawCommittedPayload {
  lotteryId: string;
  drawId: string;
  commitHash: string;
  adminId: string;
}

export interface DrawCompletedPayload {
  lotteryId: string;
  drawId: string;
  commitHash: string;
  revealedSeed: string;
  adminId: string;
  winnerIds: string[];
}

export interface WinnerSelectedPayload {
  lotteryId: string;
  drawId: string;
  winnerId: string;
  userId: string;
  prizeId: string;
  ticketNumber: number;
  place: number;
}

export interface WinnerPayoutUpdatedPayload {
  lotteryId: string;
  winnerId: string;
  userId: string;
  status: string;
  adminId: string;
}

export interface ReferralRewardCreditedPayload {
  referralId: string;
  referrerUserId: string;
  amountEtb: number;
  walletTransactionId: string;
  sourceType: string;
  sourceId: string;
}
