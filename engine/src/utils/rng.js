/**
 * xorshift32. Deterministic, seedable, allocation-free, trivially portable.
 *
 * The engine is reproducible given a seed: `ucinewgame` reseeds from the clock
 * so Colosseum games diverge, but a test or a bug report can pin the seed and
 * replay the exact game.
 */
export class Rng {
  constructor(seed = 0x2545f491) { this.s = (seed >>> 0) || 0x2545f491; }

  reseed(v) { this.s = (v >>> 0) || 0x2545f491; }

  next() {
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;  x >>>= 0;
    this.s = x;
    return x;
  }

  /** Uniform in [0, n). */
  nextInt(n) { return n <= 1 ? 0 : this.next() % n; }
}

export default Rng;