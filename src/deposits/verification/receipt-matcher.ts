import { PaymentMethod } from '@prisma/client';

export type ProviderFamily =
  | 'telebirr'
  | 'cbe'
  | 'boa'
  | 'mpesa'
  | 'awash'
  | 'dashen'
  | 'unknown';

const METHOD_TO_FAMILY: Record<PaymentMethod, ProviderFamily> = {
  telebirr: 'telebirr',
  cbe: 'cbe',
  abyssinia: 'boa',
  mpesa: 'mpesa',
  awash: 'awash',
  amole: 'dashen',
};

const SOURCE_TO_FAMILY: Record<string, ProviderFamily> = {
  'telebirr-html': 'telebirr',
  'cbe-pdf': 'cbe',
  'mb-json': 'cbe',
  'cbebirr-pdf': 'cbe',
  'boa-json': 'boa',
  'boa-qr': 'boa',
  'mpesa-pdf': 'mpesa',
  'awash-html': 'awash',
  'dashen-pdf': 'dashen',
  'dashen-html': 'dashen',
};

export function providerFamilyForMethod(method: PaymentMethod): ProviderFamily {
  return METHOD_TO_FAMILY[method] ?? 'unknown';
}

export function providerFamilyForSource(source?: string): ProviderFamily {
  if (!source) return 'unknown';
  return SOURCE_TO_FAMILY[source] ?? 'unknown';
}

export function digitsOnly(value: string | undefined | null): string {
  return (value ?? '').replace(/\D/g, '');
}

/** Normalize telebirr / phone-like accounts to comparable local form (09…). */
export function normalizePhoneAccount(value: string): string {
  let d = digitsOnly(value);
  if (d.startsWith('251') && d.length >= 12) {
    d = `0${d.slice(3)}`;
  }
  return d;
}

export function normalizeBankReference(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function parseEtbAmount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }
  if (typeof value !== 'string') return undefined;
  const match = value.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

export function amountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.009;
}

export type AccountMatchResult =
  | 'exact'
  | 'partial'
  | 'masked_skipped'
  | 'mismatch'
  | 'missing';

/**
 * Match destination account against bank-returned (often masked) receiver fields.
 */
export function matchReceiverAccount(
  expected: string,
  observed: string | undefined,
  family: ProviderFamily,
): AccountMatchResult {
  if (!expected?.trim()) return 'missing';
  if (!observed?.trim()) {
    // Telebirr often masks destination fully — amount + unique receipt still required upstream.
    return family === 'telebirr' ? 'masked_skipped' : 'missing';
  }

  const expectedDigits =
    family === 'telebirr'
      ? normalizePhoneAccount(expected)
      : digitsOnly(expected);
  const observedRaw = observed.trim();
  const observedDigits =
    family === 'telebirr'
      ? normalizePhoneAccount(observedRaw)
      : digitsOnly(observedRaw);

  if (!observedDigits) {
    return family === 'telebirr' ? 'masked_skipped' : 'missing';
  }

  if (expectedDigits === observedDigits) return 'exact';

  // Masked forms like 1****9395 or 251******** — require visible suffix/prefix alignment.
  if (/[*xX]/.test(observedRaw)) {
    const maskCount = (observedRaw.match(/[*xX]/gi) || []).length;
    // Telebirr often returns fully masked MSISDNs (e.g. 251********).
    if (family === 'telebirr' && maskCount >= 4 && observedDigits.length <= 3) {
      return 'masked_skipped';
    }

    const visibleRuns = observedRaw
      .replace(/[^\dxX*]/gi, '')
      .split(/[*xX]+/i)
      .map((p) => p.replace(/\D/g, ''))
      .filter(Boolean);

    if (visibleRuns.length === 0) {
      return family === 'telebirr' ? 'masked_skipped' : 'missing';
    }

    let cursor = 0;
    let matchedRun = false;
    for (const run of visibleRuns) {
      if (run.length < 2) continue;
      const idx = expectedDigits.indexOf(run, cursor);
      if (idx === -1) return 'mismatch';
      cursor = idx + run.length;
      matchedRun = true;
    }
    return matchedRun ? 'partial' : family === 'telebirr' ? 'masked_skipped' : 'missing';
  }

  if (
    expectedDigits.endsWith(observedDigits) ||
    observedDigits.endsWith(expectedDigits)
  ) {
    const shorter = Math.min(expectedDigits.length, observedDigits.length);
    return shorter >= 6 ? 'partial' : 'mismatch';
  }

  return 'mismatch';
}

export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function extractReceiptFields(receipt: Record<string, unknown>): {
  source?: string;
  reference?: string;
  amount?: number;
  receiver?: string;
  statusOk: boolean;
  statusLabel?: string;
} {
  const source =
    typeof receipt.source === 'string' ? receipt.source : undefined;
  const family = providerFamilyForSource(source);

  let reference: string | undefined;
  let amount: number | undefined;
  let receiver: string | undefined;
  let statusOk = true;
  let statusLabel: string | undefined;

  if (source === 'telebirr-html') {
    reference =
      (receipt.receiptNo as string) ||
      (receipt.transactionNumber as string) ||
      undefined;
    amount =
      parseEtbAmount(receipt.settledAmount) ??
      parseEtbAmount(receipt.totalPaidAmount);
    receiver = (receipt.creditedPartyAccountNo as string) || undefined;
    statusLabel = (receipt.transactionStatus as string) || undefined;
    statusOk = !statusLabel || /completed|success|successful/i.test(statusLabel);
  } else if (source === 'cbe-pdf' || source === 'mb-json' || source === 'cbebirr-pdf') {
    reference = (receipt.reference as string) || undefined;
    amount =
      parseEtbAmount(receipt.transferredAmount) ??
      parseEtbAmount(receipt.creditAmount) ??
      parseEtbAmount(receipt.totalAmount);
    receiver = (receipt.receiverAccount as string) || undefined;
  } else if (source === 'boa-json' || source === 'boa-qr') {
    reference =
      (receipt.transactionReference as string) ||
      (receipt.paymentReference as string) ||
      undefined;
    amount =
      parseEtbAmount(receipt.transferredAmount) ??
      parseEtbAmount(receipt.totalAmount);
    receiver = (receipt.receiverAccount as string) || undefined;
    statusLabel = (receipt.upstreamStatus as string) || undefined;
    statusOk = !statusLabel || /success|completed/i.test(statusLabel);
  } else if (source === 'awash-html') {
    const tx = (receipt.transaction as Record<string, unknown>) || {};
    reference = (tx.transactionId as string) || undefined;
    amount = parseEtbAmount(tx.amount);
    receiver =
      (tx.beneficiaryAccount as string) ||
      (tx.beneficiaryPhone as string) ||
      undefined;
  } else if (source === 'mpesa-pdf') {
    reference =
      (receipt.receiptNo as string) ||
      (receipt.transactionId as string) ||
      (receipt.reference as string) ||
      undefined;
    amount =
      parseEtbAmount(receipt.amount) ??
      parseEtbAmount(receipt.transferredAmount) ??
      parseEtbAmount(receipt.totalAmount);
    receiver =
      (receipt.receiverAccount as string) ||
      (receipt.receiverMsisdn as string) ||
      undefined;
  } else if (source === 'dashen-pdf' || source === 'dashen-html') {
    reference =
      (receipt.reference as string) ||
      (receipt.transactionId as string) ||
      undefined;
    amount =
      parseEtbAmount(receipt.amount) ??
      parseEtbAmount(receipt.transferredAmount) ??
      parseEtbAmount(receipt.totalAmount);
    receiver = (receipt.receiverAccount as string) || undefined;
  } else {
    reference =
      (receipt.reference as string) ||
      (receipt.receiptNo as string) ||
      (receipt.transactionReference as string) ||
      undefined;
    amount =
      parseEtbAmount(receipt.transferredAmount) ??
      parseEtbAmount(receipt.settledAmount) ??
      parseEtbAmount(receipt.totalAmount) ??
      parseEtbAmount(receipt.amount);
    receiver =
      (receipt.receiverAccount as string) ||
      (receipt.creditedPartyAccountNo as string) ||
      undefined;
  }

  void family;
  return { source, reference, amount, receiver, statusOk, statusLabel };
}

export function methodAllowsAutoVerify(method: PaymentMethod): boolean {
  return (
    method === PaymentMethod.telebirr ||
    method === PaymentMethod.cbe ||
    method === PaymentMethod.abyssinia
  );
}
