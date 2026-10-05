import { Decimal } from '@prisma/client/runtime/library';

type NumericLike = Decimal | number | string | { toString(): string };

export function toEtbNumber(value: NumericLike): number {
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

export function etbDecimal(value: number | string): Decimal {
  return new Decimal(value);
}

export function assertPositiveEtb(amount: number, label = 'amount') {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
}
