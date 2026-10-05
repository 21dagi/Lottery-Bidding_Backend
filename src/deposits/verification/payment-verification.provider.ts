export type PaymentVerificationStatus =
  | 'AUTO_APPROVED'
  | 'NEEDS_MANUAL_REVIEW'
  | 'REJECTED_DUPLICATE'
  | 'ERROR';

export interface PaymentVerificationResult {
  status: PaymentVerificationStatus;
  reason: string;
  confidence?: number;
  extractedAmount?: number;
  extractedReference?: string;
  normalizedReference?: string;
  providerFamily?: string;
  providerSource?: string;
  linksRequestId?: string;
  receiverObserved?: string;
  accountMatch?: 'exact' | 'partial' | 'masked_skipped' | 'mismatch' | 'missing';
  receiptSnapshot?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface PaymentVerificationInput {
  depositId: string;
  method: string;
  claimedAmount: number;
  expectedReceiver: string;
  externalReference?: string;
  screenshotUrl?: string;
}

export interface PaymentVerificationProvider {
  verify(input: PaymentVerificationInput): Promise<PaymentVerificationResult>;
}

export const PAYMENT_VERIFICATION_PROVIDER = Symbol(
  'PAYMENT_VERIFICATION_PROVIDER',
);

export class ManualReviewProvider implements PaymentVerificationProvider {
  async verify(
    input: PaymentVerificationInput,
  ): Promise<PaymentVerificationResult> {
    return {
      status: 'NEEDS_MANUAL_REVIEW',
      reason: 'Automatic verification is not configured',
      raw: {
        provider: 'manual',
        depositId: input.depositId,
        claimedAmount: input.claimedAmount,
        method: input.method,
      },
    };
  }
}
