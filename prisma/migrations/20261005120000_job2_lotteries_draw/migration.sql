-- Job 2 enums
CREATE TYPE "LotteryStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'OPEN', 'LOCKED', 'DRAWN', 'COMPLETED', 'CANCELLED');
CREATE TYPE "PrizeKind" AS ENUM ('money', 'product');
CREATE TYPE "TicketStatus" AS ENUM ('AVAILABLE', 'SELECTED', 'RESERVED', 'PAYMENT_PENDING', 'SOLD', 'WINNER', 'CANCELLED');
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CONVERTED', 'CANCELLED');
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'CONTACTED', 'PAID', 'DELIVERED', 'CREDITED', 'FAILED');
CREATE TYPE "HistoryTone" AS ENUM ('neutral', 'accent', 'success', 'danger');

CREATE TABLE "lotteries" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "series_label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "cover_media_id" TEXT,
    "ticket_quantity" INTEGER NOT NULL,
    "ticket_price" DECIMAL(18,2) NOT NULL,
    "status" "LotteryStatus" NOT NULL DEFAULT 'DRAFT',
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "lock_reason" TEXT,
    "created_by_admin_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lotteries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prizes" (
    "id" TEXT NOT NULL,
    "lottery_id" TEXT NOT NULL,
    "place" INTEGER NOT NULL,
    "kind" "PrizeKind" NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "detail" TEXT NOT NULL DEFAULT '',
    "amount_etb" DECIMAL(18,2),
    "image_media_id" TEXT,
    "specs" JSONB,
    "fulfillment_note" TEXT,
    CONSTRAINT "prizes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "lottery_id" TEXT NOT NULL,
    "ticket_number" INTEGER NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'AVAILABLE',
    "owner_user_id" TEXT,
    "sold_price" DECIMAL(18,2),
    "sold_at" TIMESTAMP(3),
    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ticket_reservations" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "group_id" TEXT NOT NULL,
    CONSTRAINT "ticket_reservations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lottery_id" TEXT NOT NULL,
    "ticket_ids" TEXT[],
    "total_amount" DECIMAL(18,2) NOT NULL,
    "wallet_transaction_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "draws" (
    "id" TEXT NOT NULL,
    "lottery_id" TEXT NOT NULL,
    "eligible_ticket_snapshot" JSONB NOT NULL,
    "seed_commit_hash" TEXT NOT NULL,
    "seed_reveal" TEXT,
    "seed_cipher" TEXT,
    "rng_algorithm" TEXT NOT NULL DEFAULT 'sha256-fisher-yates',
    "executed_by_admin_id" TEXT,
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "draws_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "winners" (
    "id" TEXT NOT NULL,
    "draw_id" TEXT NOT NULL,
    "lottery_id" TEXT NOT NULL,
    "prize_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payout_status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "payout_evidence_media_id" TEXT,
    "payout_notes" TEXT,
    "updated_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "winners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lottery_history_events" (
    "id" TEXT NOT NULL,
    "lottery_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "tone" "HistoryTone" NOT NULL DEFAULT 'neutral',
    CONSTRAINT "lottery_history_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrer_user_id" TEXT NOT NULL,
    "referred_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "referral_rewards" (
    "id" TEXT NOT NULL,
    "referral_id" TEXT NOT NULL,
    "wallet_transaction_id" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "rule_applied" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "referral_rules" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "purchase_percent" DECIMAL(8,2) NOT NULL DEFAULT 5,
    "deposit_flat_etb" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "referral_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prizes_lottery_id_place_key" ON "prizes"("lottery_id", "place");
CREATE UNIQUE INDEX "tickets_lottery_id_ticket_number_key" ON "tickets"("lottery_id", "ticket_number");
CREATE INDEX "tickets_lottery_id_status_idx" ON "tickets"("lottery_id", "status");
CREATE INDEX "ticket_reservations_status_expires_at_idx" ON "ticket_reservations"("status", "expires_at");
CREATE INDEX "ticket_reservations_group_id_idx" ON "ticket_reservations"("group_id");
CREATE INDEX "ticket_reservations_user_id_status_idx" ON "ticket_reservations"("user_id", "status");
CREATE INDEX "lotteries_status_deadline_at_idx" ON "lotteries"("status", "deadline_at");
CREATE INDEX "purchases_user_id_created_at_idx" ON "purchases"("user_id", "created_at");
CREATE INDEX "purchases_lottery_id_idx" ON "purchases"("lottery_id");
CREATE INDEX "draws_lottery_id_idx" ON "draws"("lottery_id");
CREATE UNIQUE INDEX "winners_draw_id_prize_id_key" ON "winners"("draw_id", "prize_id");
CREATE INDEX "winners_lottery_id_payout_status_idx" ON "winners"("lottery_id", "payout_status");
CREATE INDEX "winners_user_id_idx" ON "winners"("user_id");
CREATE INDEX "lottery_history_events_lottery_id_at_idx" ON "lottery_history_events"("lottery_id", "at");
CREATE UNIQUE INDEX "referrals_referred_user_id_key" ON "referrals"("referred_user_id");
CREATE INDEX "referrals_referrer_user_id_idx" ON "referrals"("referrer_user_id");
CREATE UNIQUE INDEX "referral_rewards_source_type_source_id_rule_applied_key" ON "referral_rewards"("source_type", "source_id", "rule_applied");
CREATE INDEX "referral_rewards_referral_id_idx" ON "referral_rewards"("referral_id");

ALTER TABLE "lotteries" ADD CONSTRAINT "lotteries_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_image_media_id_fkey" FOREIGN KEY ("image_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ticket_reservations" ADD CONSTRAINT "ticket_reservations_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_reservations" ADD CONSTRAINT "ticket_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draws" ADD CONSTRAINT "draws_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "winners" ADD CONSTRAINT "winners_draw_id_fkey" FOREIGN KEY ("draw_id") REFERENCES "draws"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "winners" ADD CONSTRAINT "winners_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "winners" ADD CONSTRAINT "winners_prize_id_fkey" FOREIGN KEY ("prize_id") REFERENCES "prizes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "winners" ADD CONSTRAINT "winners_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "winners" ADD CONSTRAINT "winners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "winners" ADD CONSTRAINT "winners_payout_evidence_media_id_fkey" FOREIGN KEY ("payout_evidence_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lottery_history_events" ADD CONSTRAINT "lottery_history_events_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_fkey" FOREIGN KEY ("referrer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
