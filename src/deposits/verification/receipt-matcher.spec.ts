import {
  amountsEqual,
  extractReceiptFields,
  matchReceiverAccount,
  normalizePhoneAccount,
  parseEtbAmount,
} from './receipt-matcher';

describe('receipt-matcher', () => {
  it('parses telebirr amount strings', () => {
    expect(parseEtbAmount('100 Birr')).toBe(100);
    expect(parseEtbAmount('1,250.50 ETB')).toBe(1250.5);
  });

  it('matches telebirr phones across 251 / 09 forms', () => {
    expect(normalizePhoneAccount('251961155660')).toBe('0961155660');
    expect(matchReceiverAccount('0961155660', '0961155660', 'telebirr')).toBe(
      'exact',
    );
    expect(
      matchReceiverAccount('0961155660', '251********', 'telebirr'),
    ).toBe('masked_skipped');
  });

  it('matches masked CBE accounts by visible digits', () => {
    expect(
      matchReceiverAccount('1000442979395', '1********9395', 'cbe'),
    ).toBe('partial');
    expect(
      matchReceiverAccount('1000442979395', '1********0001', 'cbe'),
    ).toBe('mismatch');
  });

  it('extracts telebirr receipt fields', () => {
    const fields = extractReceiptFields({
      source: 'telebirr-html',
      receiptNo: 'ABC123',
      settledAmount: '200 Birr',
      creditedPartyAccountNo: '0961155660',
      transactionStatus: 'Completed',
    });
    expect(fields.reference).toBe('ABC123');
    expect(fields.amount).toBe(200);
    expect(fields.statusOk).toBe(true);
    expect(amountsEqual(fields.amount!, 200)).toBe(true);
  });
});
