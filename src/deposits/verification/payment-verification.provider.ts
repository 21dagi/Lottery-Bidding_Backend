export interface PaymentVerificationResult {
  status: 'AUTO_APPROVED' | 'AUTO_REJECTED' | 'NEEDS_MANUAL_REVIEW' | 'ERROR';
  confidence?: number;
  extractedAmount?: number;
  extractedReference?: string;
  raw: Record<string, unknown>;
}

export interface PaymentVerificationProvider {
  verify(input: {
    depositId: string;
    screenshotUrl: string;
    claimedAmount: number;
  }): Promise<PaymentVerificationResult>;
}

export const PAYMENT_VERIFICATION_PROVIDER = Symbol(
  'PAYMENT_VERIFICATION_PROVIDER',
);

export class ManualReviewProvider implements PaymentVerificationProvider {
  async verify(input: {
    depositId: string;
    screenshotUrl: string;
    claimedAmount: number;
  }): Promise<PaymentVerificationResult> {
    return {
      status: 'NEEDS_MANUAL_REVIEW',
      raw: {
        provider: 'manual',
        depositId: input.depositId,
        claimedAmount: input.claimedAmount,
        screenshotUrl: input.screenshotUrl,
      },
    };
  }
}
