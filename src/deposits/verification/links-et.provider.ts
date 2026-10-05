import { Injectable, Logger } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { LinksEtClient } from './links-et.client';
import {
  PaymentVerificationInput,
  PaymentVerificationProvider,
  PaymentVerificationResult,
} from './payment-verification.provider';
import {
  amountsEqual,
  extractReceiptFields,
  looksLikeUrl,
  matchReceiverAccount,
  methodAllowsAutoVerify,
  normalizeBankReference,
  providerFamilyForMethod,
  providerFamilyForSource,
} from './receipt-matcher';

@Injectable()
export class LinksEtPaymentVerificationProvider
  implements PaymentVerificationProvider
{
  private readonly logger = new Logger(LinksEtPaymentVerificationProvider.name);

  constructor(private readonly links: LinksEtClient) {}

  async verify(
    input: PaymentVerificationInput,
  ): Promise<PaymentVerificationResult> {
    const method = input.method as PaymentMethod;

    if (!this.links.isConfigured()) {
      return {
        status: 'NEEDS_MANUAL_REVIEW',
        reason: 'LINKS_ET_API_KEY not configured',
        raw: { provider: 'links.et', configured: false },
      };
    }

    if (!methodAllowsAutoVerify(method)) {
      return {
        status: 'NEEDS_MANUAL_REVIEW',
        reason: `Method ${method} requires manual approval`,
        raw: { provider: 'links.et', method },
      };
    }

    if (!input.expectedReceiver?.trim()) {
      return {
        status: 'NEEDS_MANUAL_REVIEW',
        reason: 'Destination account is not configured for this method',
        raw: { provider: 'links.et', method },
      };
    }

    try {
      const fetched = await this.fetchReceipt(input, method);
      if (fetched.kind === 'manual') {
        return fetched.result;
      }
      return this.evaluateReceipt(input, method, fetched);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      this.logger.warn(`links.et verify failed deposit=${input.depositId}: ${message}`);
      return {
        status: 'NEEDS_MANUAL_REVIEW',
        reason: message,
        raw: { provider: 'links.et', error: message },
      };
    }
  }

  private async fetchReceipt(
    input: PaymentVerificationInput,
    method: PaymentMethod,
  ): Promise<
    | {
        kind: 'ok';
        receipt: Record<string, unknown>;
        raw: Record<string, unknown>;
        linksRequestId?: string;
        weakEvidence?: boolean;
        weakReason?: string;
      }
    | { kind: 'manual'; result: PaymentVerificationResult }
  > {
    const ref = input.externalReference?.trim();
    const idempotencyKey = `deposit:${input.depositId}`;

    // Prefer URL / telebirr reference over screenshot — stronger + cheaper.
    if (ref) {
      if (looksLikeUrl(ref)) {
        const { httpStatus, data } = await this.links.verifyUntilResolved(
          { url: ref },
          idempotencyKey,
        );
        return this.unwrapVerifyResponse(httpStatus, data, input);
      }

      if (method === PaymentMethod.telebirr) {
        const { httpStatus, data } = await this.links.verifyUntilResolved(
          { reference: ref },
          `${idempotencyKey}:ref`,
        );
        return this.unwrapVerifyResponse(httpStatus, data, input);
      }

      // CBE / BOA bare reference cannot build a receipt URL — need URL or image.
      if (!input.screenshotUrl) {
        return {
          kind: 'manual',
          result: {
            status: 'NEEDS_MANUAL_REVIEW',
            reason:
              'CBE/BOA need a full receipt URL or screenshot; bare reference is not enough',
            extractedReference: ref,
            raw: { provider: 'links.et', note: 'provider_needs_full_url' },
          },
        };
      }
    }

    if (!input.screenshotUrl) {
      return {
        kind: 'manual',
        result: {
          status: 'NEEDS_MANUAL_REVIEW',
          reason: 'No receipt URL/reference or screenshot provided',
          raw: { provider: 'links.et' },
        },
      };
    }

    const imageBase64 = await this.downloadAsBase64(input.screenshotUrl);
    const { httpStatus, data } = await this.links.verifyImage(
      imageBase64,
      `${idempotencyKey}:img`,
    );

    if (httpStatus === 401 || httpStatus === 403) {
      return {
        kind: 'manual',
        result: {
          status: 'NEEDS_MANUAL_REVIEW',
          reason: 'links.et API key rejected',
          raw: sanitizeRaw(data),
        },
      };
    }

    if (httpStatus === 429) {
      return {
        kind: 'manual',
        result: {
          status: 'NEEDS_MANUAL_REVIEW',
          reason: 'links.et rate or quota limit — queued for admin',
          raw: sanitizeRaw(data),
        },
      };
    }

    const upstream = (data.upstream as Record<string, unknown>) || {};
    const attempted = Boolean(upstream.attempted);
    const reason = String(upstream.reason ?? '');

    // BOA QR from screenshot is not bank-fetched — never auto-approve.
    if (!attempted && reason === 'qr_receipt') {
      const qrReceipt = (upstream.receipt as Record<string, unknown>) || {};
      return {
        kind: 'manual',
        result: {
          status: 'NEEDS_MANUAL_REVIEW',
          reason:
            'BOA QR screenshot is not bank-confirmed; admin must review',
          extractedReference:
            (qrReceipt.transactionReference as string) || undefined,
          providerFamily: 'boa',
          providerSource: 'boa-qr',
          raw: sanitizeRaw(data),
        },
      };
    }

    if (!attempted) {
      return {
        kind: 'manual',
        result: {
          status: 'NEEDS_MANUAL_REVIEW',
          reason:
            reason === 'provider_needs_full_url'
              ? 'Screenshot needs a full receipt URL for this bank'
              : `Image verification incomplete (${reason || 'unknown'})`,
          raw: sanitizeRaw(data),
        },
      };
    }

    const result = (upstream.result as Record<string, unknown>) || {};
    if (!result.ok || !result.receipt) {
      return {
        kind: 'manual',
        result: {
          status: 'NEEDS_MANUAL_REVIEW',
          reason: 'Bank receipt could not be confirmed from screenshot',
          raw: sanitizeRaw(data),
        },
      };
    }

    return {
      kind: 'ok',
      receipt: result.receipt as Record<string, unknown>,
      raw: sanitizeRaw(data),
      linksRequestId: (result.requestId as string) || undefined,
    };
  }

  private unwrapVerifyResponse(
    httpStatus: number,
    data: Record<string, unknown>,
    input: PaymentVerificationInput,
  ):
    | {
        kind: 'ok';
        receipt: Record<string, unknown>;
        raw: Record<string, unknown>;
        linksRequestId?: string;
      }
    | { kind: 'manual'; result: PaymentVerificationResult } {
    if (httpStatus === 202) {
      return {
        kind: 'manual',
        result: {
          status: 'NEEDS_MANUAL_REVIEW',
          reason: 'Verification still processing — admin will finish review',
          linksRequestId: (data.requestId as string) || undefined,
          raw: sanitizeRaw(data),
        },
      };
    }

    if (httpStatus === 401 || httpStatus === 403) {
      return {
        kind: 'manual',
        result: {
          status: 'NEEDS_MANUAL_REVIEW',
          reason: 'links.et API key rejected',
          raw: sanitizeRaw(data),
        },
      };
    }

    if (httpStatus === 429) {
      return {
        kind: 'manual',
        result: {
          status: 'NEEDS_MANUAL_REVIEW',
          reason: 'links.et rate or quota limit — queued for admin',
          raw: sanitizeRaw(data),
        },
      };
    }

    if (httpStatus === 502 || data.ok === false) {
      return {
        kind: 'manual',
        result: {
          status: 'NEEDS_MANUAL_REVIEW',
          reason: 'Bank receipt failed validation at verifier',
          raw: sanitizeRaw(data),
        },
      };
    }

    if (httpStatus >= 400 || !data.ok || !data.receipt) {
      return {
        kind: 'manual',
        result: {
          status: 'NEEDS_MANUAL_REVIEW',
          reason: 'Could not fetch bank receipt — queued for admin',
          raw: sanitizeRaw(data),
        },
      };
    }

    void input;
    return {
      kind: 'ok',
      receipt: data.receipt as Record<string, unknown>,
      raw: sanitizeRaw(data),
      linksRequestId: (data.requestId as string) || undefined,
    };
  }

  private evaluateReceipt(
    input: PaymentVerificationInput,
    method: PaymentMethod,
    fetched: {
      receipt: Record<string, unknown>;
      raw: Record<string, unknown>;
      linksRequestId?: string;
    },
  ): PaymentVerificationResult {
    const expectedFamily = providerFamilyForMethod(method);
    const fields = extractReceiptFields(fetched.receipt);
    const sourceFamily = providerFamilyForSource(fields.source);

    if (!fields.source || sourceFamily === 'unknown') {
      return {
        status: 'NEEDS_MANUAL_REVIEW',
        reason: 'Unrecognized receipt format',
        raw: fetched.raw,
        linksRequestId: fetched.linksRequestId,
      };
    }

    if (sourceFamily !== expectedFamily) {
      return {
        status: 'NEEDS_MANUAL_REVIEW',
        reason: `Receipt is ${sourceFamily} but deposit method is ${method}`,
        providerSource: fields.source,
        providerFamily: sourceFamily,
        extractedReference: fields.reference,
        extractedAmount: fields.amount,
        raw: fetched.raw,
        linksRequestId: fetched.linksRequestId,
      };
    }

    if (!fields.reference?.trim()) {
      return {
        status: 'NEEDS_MANUAL_REVIEW',
        reason: 'Receipt missing transaction reference',
        providerSource: fields.source,
        providerFamily: sourceFamily,
        extractedAmount: fields.amount,
        raw: fetched.raw,
        linksRequestId: fetched.linksRequestId,
      };
    }

    if (fields.amount === undefined) {
      return {
        status: 'NEEDS_MANUAL_REVIEW',
        reason: 'Could not parse amount from receipt',
        providerSource: fields.source,
        providerFamily: sourceFamily,
        extractedReference: fields.reference,
        raw: fetched.raw,
        linksRequestId: fetched.linksRequestId,
      };
    }

    if (!amountsEqual(fields.amount, input.claimedAmount)) {
      return {
        status: 'NEEDS_MANUAL_REVIEW',
        reason: `Amount mismatch: receipt ${fields.amount} ETB vs claimed ${input.claimedAmount} ETB`,
        providerSource: fields.source,
        providerFamily: sourceFamily,
        extractedReference: fields.reference,
        extractedAmount: fields.amount,
        receiverObserved: fields.receiver,
        raw: fetched.raw,
        linksRequestId: fetched.linksRequestId,
      };
    }

    if (!fields.statusOk) {
      return {
        status: 'NEEDS_MANUAL_REVIEW',
        reason: `Transaction status is not successful (${fields.statusLabel || 'unknown'})`,
        providerSource: fields.source,
        providerFamily: sourceFamily,
        extractedReference: fields.reference,
        extractedAmount: fields.amount,
        raw: fetched.raw,
        linksRequestId: fetched.linksRequestId,
      };
    }

    const accountMatch = matchReceiverAccount(
      input.expectedReceiver,
      fields.receiver,
      expectedFamily,
    );

    if (accountMatch === 'mismatch' || accountMatch === 'missing') {
      return {
        status: 'NEEDS_MANUAL_REVIEW',
        reason:
          accountMatch === 'missing'
            ? 'Receipt missing destination account'
            : 'Destination account does not match our pay-to wallet',
        providerSource: fields.source,
        providerFamily: sourceFamily,
        extractedReference: fields.reference,
        extractedAmount: fields.amount,
        receiverObserved: fields.receiver,
        accountMatch,
        raw: fetched.raw,
        linksRequestId: fetched.linksRequestId,
      };
    }

    const normalizedReference = normalizeBankReference(fields.reference);

    return {
      status: 'AUTO_APPROVED',
      reason:
        accountMatch === 'masked_skipped'
          ? 'Bank receipt verified (destination masked by provider)'
          : 'Bank receipt verified',
      extractedAmount: fields.amount,
      extractedReference: fields.reference,
      normalizedReference,
      providerFamily: sourceFamily,
      providerSource: fields.source,
      receiverObserved: fields.receiver,
      accountMatch,
      linksRequestId: fetched.linksRequestId,
      receiptSnapshot: {
        source: fields.source,
        reference: fields.reference,
        amount: fields.amount,
        receiver: fields.receiver,
        status: fields.statusLabel,
      },
      raw: fetched.raw,
    };
  }

  private async downloadAsBase64(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download screenshot (${res.status})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // links.et limit ~5MB base64 ≈ 3.75MB raw
    if (buf.length > 3_750_000) {
      throw new Error('Screenshot too large for verification');
    }
    return buf.toString('base64');
  }
}

/** Strip resolvedUrl / long HTML so we never persist raw receipt URLs in logs loudly. */
function sanitizeRaw(data: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...data };
  if ('resolvedUrl' in clone) clone.resolvedUrl = '[redacted]';
  if (typeof clone.rawHtmlLength === 'number') {
    // keep length only
  }
  return clone;
}
