import { toEtbNumber, etbDecimal } from './money';

describe('money utils', () => {
  it('round-trips decimal ETB', () => {
    const d = etbDecimal(100.5);
    expect(toEtbNumber(d)).toBe(100.5);
    expect(toEtbNumber(d.plus(etbDecimal(50)))).toBe(150.5);
  });
});
