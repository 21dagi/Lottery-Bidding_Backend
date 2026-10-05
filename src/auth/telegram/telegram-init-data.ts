import { createHmac, timingSafeEqual } from 'crypto';

export interface TelegramUserPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface VerifiedInitData {
  user: TelegramUserPayload;
  authDate: number;
  startParam?: string;
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Validates Telegram Mini App initData (official WebApp algorithm).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Only trust fields after HMAC verifies. Never accept a client-supplied
 * telegram id / username outside this signed payload.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400,
): VerifiedInitData {
  if (!botToken || botToken === 'replace-me-bot-token') {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    throw new Error('Missing or invalid hash');
  }
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

  if (!safeEqualHex(computed, hash.toLowerCase())) {
    throw new Error('Invalid Telegram initData signature');
  }

  const authDateRaw = params.get('auth_date');
  if (!authDateRaw) throw new Error('Missing auth_date');
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) throw new Error('Invalid auth_date');
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age < -60) {
    // Clock skew / future-dated payload
    throw new Error('Telegram initData auth_date is in the future');
  }
  if (age > maxAgeSeconds) {
    throw new Error('Telegram initData expired');
  }

  const userRaw = params.get('user');
  if (!userRaw) throw new Error('Missing user');
  let user: TelegramUserPayload;
  try {
    user = JSON.parse(userRaw) as TelegramUserPayload;
  } catch {
    throw new Error('Invalid user payload JSON');
  }
  if (!user || typeof user.id !== 'number' || !Number.isInteger(user.id) || user.id <= 0) {
    throw new Error('Invalid user id in Telegram payload');
  }

  return {
    user,
    authDate,
    startParam: params.get('start_param') || undefined,
  };
}

/** Test helper: build a valid initData string for a given bot token. */
export function buildTestInitData(
  botToken: string,
  user: TelegramUserPayload,
  authDate = Math.floor(Date.now() / 1000),
): string {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify(user));
  params.set('auth_date', String(authDate));
  const entries = Array.from(params.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const hash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');
  params.set('hash', hash);
  return params.toString();
}
