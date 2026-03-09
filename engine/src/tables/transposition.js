/**
 * Transposition table — struct-of-arrays layout over typed arrays.
 *
 * Memory accounting (per entry):
 *   BigInt64Array key    : 8 bytes
 *   Int32Array   score   : 4 bytes
 *   Int32Array   move    : 4 bytes  (encoded: from|to<<6|promo<<12)
 *   Int8Array    depth   : 1 byte
 *   Int8Array    flag    : 1 byte
 *   Uint8Array   age     : 1 byte
 *   ─────────────────────────────
 *   Total                : 19 bytes
 *
 * A "64MB" table holds ~3.3M entries and uses exactly 64MB.
 * The previous object-array version claimed 40 bytes/entry but actually
 * used ~150+ bytes plus retained move-object graphs — real size was ~400MB.
 */

import { LOG } from '../logging/logger.js';

export const TT_FLAG = {
  EXACT: 0,
  LOWER_BOUND: 1,   // fail-high (beta cutoff)
  UPPER_BOUND: 2,   // fail-low
};

// ─────────────────────────────────────────────────────────────────────────────
// Move encoding: 15 bits packed into a 32-bit int.
//   bits  0–5  : from square (0–63)
//   bits  6–11 : to square   (0–63)
//   bits 12–14 : promotion piece (0 = none, 1–5 = piece type)
// Encoded value 0 means "no move" (a1→a1 with no promo is never legal).
// ─────────────────────────────────────────────────────────────────────────────
export function encodeMove(move) {
  if (!move) return 0;
  return move.fromSquare | (move.toSquare << 6) | ((move.promotionPiece || 0) << 12);
}
export function decodeFrom(e)  { return e & 0x3F; }
export function decodeTo(e)    { return (e >>> 6) & 0x3F; }
export function decodePromo(e) { return (e >>> 12) & 0x7; }

/** Check whether an encoded move matches a move object's from/to/promo. */
export function encodedMatches(encoded, move) {
  if (encoded === 0) return false;
  return (encoded & 0x3F) === move.fromSquare &&
         ((encoded >>> 6) & 0x3F) === move.toSquare &&
         ((encoded >>> 12) & 0x7) === (move.promotionPiece || 0);
}

const BYTES_PER_ENTRY = 19;

export class TranspositionTable {
  constructor(sizeMB = 64) {
    // Round entry count down to a power of two so indexing is a bitmask,
    // avoiding BigInt modulo in the hot path.
    let n = Math.floor((sizeMB * 1024 * 1024) / BYTES_PER_ENTRY);
    let pow2 = 1;
    while (pow2 * 2 <= n) pow2 *= 2;
    this.size = pow2;
    this.indexMask = BigInt(pow2 - 1);

    // Struct-of-arrays. Contiguous, cache-friendly, no per-entry objects.
    this.keys   = new BigInt64Array(this.size);
    this.scores = new Int32Array(this.size);
    this.moves  = new Int32Array(this.size);     // encoded
    this.depths = new Int8Array(this.size);
    this.flags  = new Int8Array(this.size);
    this.ages   = new Uint8Array(this.size);

    this.currentAge = 0;

    // Counters — cheap to maintain, useful in tests
    this.hits = 0;
    this.misses = 0;
    this.stores = 0;
    this.collisions = 0;

    // ── Reusable probe result ──
    // probe() writes into this and returns it. Caller MUST NOT hold a
    // reference across calls. This avoids one object allocation per probe,
    // which matters because probe is called once per node.
    this._probeResult = { hit: false, usable: false, score: 0, flag: 0, move: 0 };

    if (LOG.tt) {
      console.log(`[TT] ${sizeMB}MB → ${this.size} entries (${(this.size * BYTES_PER_ENTRY / 1024 / 1024).toFixed(1)}MB actual)`);
    }
  }

  _index(key) {
    // Low bits of the zobrist key masked to table size. Number() is safe
    // here because the mask guarantees the result fits in 32 bits.
    return Number(key & this.indexMask);
  }

  /**
   * Store. bestMove is encoded to an integer — this is the critical fix that
   * stops the TT from retaining move objects (and their scoreBreakdown,
   * openingAnalysis, etc.) across the entire search.
   */
  store(key, depth, score, flag, bestMove) {
    const i = this._index(key);

    // Replacement: prefer entries from the current search, and deeper ones.
    // An aged entry is always replaceable — keeps the table fresh.
    const slotAge = this.ages[i];
    const slotKey = this.keys[i];
    if (slotKey !== 0n && slotAge === this.currentAge && this.depths[i] > depth) {
      return;   // existing entry is better; keep it
    }

    if (slotKey !== 0n && slotKey !== key) this.collisions++;

    this.keys[i]   = key;
    this.depths[i] = depth;
    this.scores[i] = score;
    this.flags[i]  = flag;
    this.moves[i]  = encodeMove(bestMove);   // ← integer, not object reference
    this.ages[i]   = this.currentAge;
    this.stores++;
  }

  /**
   * Probe. Returns the shared _probeResult object — do not retain it.
   * .hit    : slot matched the key
   * .move   : encoded best-move hint (always valid when .hit, even if depth insufficient)
   * .usable : the stored score can be returned directly (depth + bound check passed)
   * .score  : stored score (only meaningful when .usable)
   */
  probe(key, depth, alpha, beta) {
    const r = this._probeResult;
    const i = this._index(key);

    if (this.keys[i] !== key) {
      this.misses++;
      r.hit = false;
      return r;
    }

    r.hit = true;
    r.move = this.moves[i];

    if (this.depths[i] < depth) {
      // Depth too shallow to trust the score, but the move hint is still
      // valuable for ordering — return it via r.move, mark score unusable.
      this.misses++;
      r.usable = false;
      return r;
    }

    this.hits++;
    const score = this.scores[i];
    const flag = this.flags[i];

    r.score = score;
    r.flag = flag;
    r.usable =
      flag === TT_FLAG.EXACT ||
      (flag === TT_FLAG.LOWER_BOUND && score >= beta) ||
      (flag === TT_FLAG.UPPER_BOUND && score <= alpha);

    return r;
  }

  /** Encoded best-move hint for a key, or 0 if not found. */
  getBestMove(key) {
    const i = this._index(key);
    return this.keys[i] === key ? this.moves[i] : 0;
  }

  newSearch() {
    // Wrap at 255 since we store age in a Uint8. When it wraps, all entries
    // look "aged" and become replaceable — effectively a soft clear.
    this.currentAge = (this.currentAge + 1) & 0xFF;
    this.hits = 0;
    this.misses = 0;
    this.stores = 0;
    this.collisions = 0;
  }

  clear() {
    this.keys.fill(0n);
    this.scores.fill(0);
    this.moves.fill(0);
    this.depths.fill(0);
    this.flags.fill(0);
    this.ages.fill(0);
    this.currentAge = 0;
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      stores: this.stores,
      collisions: this.collisions,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(1) + '%' : 'n/a',
      usage: this._estimateUsage(),
    };
  }

  _estimateUsage() {
    // Sample 1024 slots rather than scanning the full table.
    const sample = Math.min(1024, this.size);
    const stride = Math.max(1, Math.floor(this.size / sample));
    let used = 0;
    for (let i = 0; i < this.size; i += stride) {
      if (this.keys[i] !== 0n) used++;
    }
    return ((used * stride / this.size) * 100).toFixed(1) + '%';
  }
}

export default TranspositionTable;