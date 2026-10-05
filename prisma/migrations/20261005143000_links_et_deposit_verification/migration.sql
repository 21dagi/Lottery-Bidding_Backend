-- CreateEnum
CREATE TYPE "DepositVerificationOutcome" AS ENUM ('PENDING', 'AUTO_APPROVED', 'NEEDS_MANUAL_REVIEW', 'REJECTED_DUPLICATE');

-- AlterTable
ALTER TABLE "deposits" ALTER COLUMN "media_id" DROP NOT NULL;
ALTER TABLE "deposits" ADD COLUMN "external_reference" TEXT;
ALTER TABLE "deposits" ADD COLUMN "verification_outcome" "DepositVerificationOutcome" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "deposits" ADD COLUMN "verified_amount" DECIMAL(18,2);
ALTER TABLE "deposits" ADD COLUMN "verified_provider_source" TEXT;
ALTER TABLE "deposits" ADD COLUMN "links_request_id" TEXT;
ALTER TABLE "deposits" ADD COLUMN "normalized_bank_reference" TEXT;

-- CreateIndex
CREATE INDEX "deposits_normalized_bank_reference_idx" ON "deposits"("normalized_bank_reference");

-- CreateTable
CREATE TABLE "verified_payment_receipts" (
    "id" TEXT NOT NULL,
    "provider_family" TEXT NOT NULL,
    "normalized_reference" TEXT NOT NULL,
    "deposit_id" TEXT NOT NULL,
    "amount_etb" DECIMAL(18,2) NOT NULL,
    "receiver_matched" TEXT,
    "receipt_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verified_payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verified_payment_receipts_deposit_id_key" ON "verified_payment_receipts"("deposit_id");

-- CreateIndex
CREATE UNIQUE INDEX "verified_payment_receipts_provider_family_normalized_refere_key" ON "verified_payment_receipts"("provider_family", "normalized_reference");

-- CreateIndex
CREATE INDEX "verified_payment_receipts_created_at_idx" ON "verified_payment_receipts"("created_at");

-- AddForeignKey
ALTER TABLE "verified_payment_receipts" ADD CONSTRAINT "verified_payment_receipts_deposit_id_fkey" FOREIGN KEY ("deposit_id") REFERENCES "deposits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
