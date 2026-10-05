import { selectWinnersDeterministic, commitSeed, sha256Hex } from './draw-rng';

describe('draw RNG determinism', () => {
  it('same seed + snapshot → same winners', () => {
    const { seedHex } = commitSeed();
    const snapshot = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
    const a = selectWinnersDeterministic(seedHex, snapshot, 3);
    const b = selectWinnersDeterministic(seedHex, snapshot, 3);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
  });

  it('commit hash matches reveal seed', () => {
    const { seedHex, commitHash } = commitSeed();
    expect(sha256Hex(seedHex)).toBe(commitHash);
  });

  it('different seeds diverge', () => {
    const snapshot = Array.from({ length: 50 }, (_, i) => `t${i}`);
    const a = selectWinnersDeterministic('aa'.repeat(32), snapshot, 3);
    const b = selectWinnersDeterministic('bb'.repeat(32), snapshot, 3);
    expect(a.join(',')).not.toEqual(b.join(','));
  });
});
