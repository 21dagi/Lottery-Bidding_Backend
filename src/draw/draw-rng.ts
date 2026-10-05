import { createHash, createHmac, randomBytes } from 'crypto';

/**
 * Deterministic Fisher–Yates using HMAC-SHA256 counter mode.
 * Same seed + ordered ticket ids → same winner sequence. Auditable.
 */
export function selectWinnersDeterministic(
  seedHex: string,
  eligibleTicketIds: string[],
  prizeCount: number,
): string[] {
  if (prizeCount <= 0) return [];
  if (eligibleTicketIds.length < prizeCount) {
    throw new Error('Not enough eligible tickets for prizes');
  }

  const pool = [...eligibleTicketIds];
  const winners: string[] = [];

  for (let i = 0; i < prizeCount; i++) {
    const remaining = pool.length - i;
    const rand = hmacUInt32(seedHex, i);
    const j = i + (rand % remaining);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
    winners.push(pool[i]);
  }

  return winners;
}

export function commitSeed(): { seedHex: string; commitHash: string } {
  const seedHex = randomBytes(32).toString('hex');
  const commitHash = sha256Hex(seedHex);
  return { seedHex, commitHash };
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function hmacUInt32(seedHex: string, counter: number): number {
  const mac = createHmac('sha256', Buffer.from(seedHex, 'hex'))
    .update(Buffer.from(String(counter)))
    .digest();
  return mac.readUInt32BE(0);
}
