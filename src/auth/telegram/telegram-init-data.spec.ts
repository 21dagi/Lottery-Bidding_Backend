import { createHmac } from 'crypto';
import { buildTestInitData } from './telegram-init-data';

describe('verifyTelegramInitData helpers', () => {
  const botToken = '123456:ABC-DEF';

  it('buildTestInitData produces parsable signed initData', () => {
    const initData = buildTestInitData(botToken, {
      id: 42,
      first_name: 'Ada',
      username: 'ada',
    });
    const params = new URLSearchParams(initData);
    expect(params.get('hash')).toBeTruthy();
    expect(params.get('user')).toContain('"id":42');

    // recompute hash
    const hash = params.get('hash')!;
    params.delete('hash');
    const entries = Array.from(params.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');
    const secretKey = createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();
    const computed = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');
    expect(computed).toBe(hash);
  });
});
