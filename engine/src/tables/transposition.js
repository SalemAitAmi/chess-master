/**
 * Transposition table — struct-of-arrays over typed arrays, 2-way buckets.
 *
 * Memory accounting (per entry):
 *   BigUint64Array key  : 8 bytes
 *   Int32Array   score  : 4 bytes
 *   Int32Array   move   : 4 bytes  (encoded: from|to<<6|promo<<12)
 *   Int8Array    depth  : 1 byte
 *   Int8Array    flag   : 1 byte
 *   Uint8Array   age    : 1 byte
 *   ─────────────────────────────
 *   Total               : 19 bytes
 *
 * BUCKETS. A bucket is the slot pair (i, i|1) where i = key & mask (mask has
 * its low bit cleared, so i is always even). Slot A is depth-preferred, slot B
 * is always-replace. With a single slot, one deep entry locked out its index
 * for the remainder of a search, so a stale best-move hint from a fail-low node
 * kept being served at TT_MOVE priority and re-seeded the same line everywhere.
 *
 * NOT SHARED. One table per engine instance. The reusable probe result below is
 * per-table mutable state; every field is written on every path so a caller can
 * never read a value left over from a previous probe.
 */
import logger, { LOG, CAT } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;

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

export function encodedMatches(encoded, move) {
  if (encoded === 0) return false;
  return (encoded & 0x3F) === move.fromSquare &&
         ((encoded >>> 6) & 0x3F) === move.toSquare &&
         ((encoded >>> 12) & 0x7) === (move.promotionPiece || 0);
}

const BYTES_PER_ENTRY = 19;
const FILL_SAMPLE = 1024;

export class TranspositionTable {
  constructor(sizeMB = 64) {
    let n = Math.floor((sizeMB * 1024 * 1024) / BYTES_PER_ENTRY);
    let pow2 = 2;
    while (pow2 * 2 <= n) pow2 *= 2;
    this.size = pow2;
    // Low bit cleared so the masked index is always the EVEN slot of a bucket.
    this.indexMask = BigInt((pow2 - 1) & ~1);

    this.keys   = new BigUint64Array(this.size);
    this.scores = new Int32Array(this.size);
    this.moves  = new Int32Array(this.size);
    this.depths = new Int8Array(this.size);
    this.flags  = new Int8Array(this.size);
    this.ages   = new Uint8Array(this.size);

    this.currentAge = 0;

    this.hits = 0;
    this.misses = 0;
    this.stores = 0;
    this.collisions = 0;
    this.hitAgeSum = 0;     // Σ (currentAge - storedAge) & 0xFF over hits
    this.hitDepthSum = 0;

    // Reusable probe result. Read immediately; never retain.
    this._probeResult = { hit: false, usable: false, score: 0, flag: 0, move: 0, age: 0, depth: 0 };

    if (__LOG__ && LOG.tt) {
      logger.event(CAT.TT, 'init', {
        mb: sizeMB, entries: this.size,
        actualMB: +(this.size * BYTES_PER_ENTRY / 1024 / 1024).toFixed(1),
      });
    }
  }

  /** Even slot of the bucket for `key`. The odd slot is `| 1`. */
  _bucket(key) { return Number(key & this.indexMask); }

  _write(i, key, depth, score, flag, bestMove) {
    this.keys[i]   = key;
    this.depths[i] = depth;
    this.scores[i] = score;
    this.flags[i]  = flag;
    this.moves[i]  = encodeMove(bestMove);
    this.ages[i]   = this.currentAge;
    this.stores++;
  }

  store(key, depth, score, flag, bestMove) {
    const a = this._bucket(key), b = a | 1;

    // Same position already present → refresh unless the stored entry is both
    // deeper and from this search.
    let i = this.keys[a] === key ? a : (this.keys[b] === key ? b : -1);
    if (i >= 0) {
      if (this.depths[i] > depth && this.ages[i] === this.currentAge) {
        this.ages[i] = this.currentAge;
        return;
      }
      this._write(i, key, depth, score, flag, bestMove);
      return;
    }

    // New position: take the depth-preferred slot if it is stale or shallower,
    // otherwise the always-replace slot.
    const aStale = this.keys[a] === 0n || this.ages[a] !== this.currentAge;
    i = (aStale || this.depths[a] <= depth) ? a : b;
    if (this.keys[i] !== 0n && this.keys[i] !== key) this.collisions++;
    this._write(i, key, depth, score, flag, bestMove);
  }

  /**
   * Probe. Returns the shared _probeResult — do not retain it.
   * .hit    slot matched the key
   * .move   encoded best-move hint (valid whenever .hit)
   * .usable the stored score may be returned directly
   * .score  stored score (meaningful only when .usable)
   * .age    generations since the entry was written
   */
  probe(key, depth, alpha, beta) {
    const r = this._probeResult;
    const a = this._bucket(key), b = a | 1;
    const i = this.keys[a] === key ? a : (this.keys[b] === key ? b : -1);

    if (i < 0) {
      this.misses++;
      r.hit = false; r.usable = false; r.move = 0; r.score = 0; r.flag = 0;
      r.age = 0; r.depth = 0;
      return r;
    }

    r.hit = true;
    r.move = this.moves[i];
    r.age = (this.currentAge - this.ages[i]) & 0xFF;
    r.depth = this.depths[i];

    if (this.depths[i] < depth) {
      // Too shallow to trust the score; the move hint is still worth having.
      this.misses++;
      r.usable = false; r.score = 0; r.flag = 0;
      return r;
    }

    this.hits++;
    this.hitAgeSum += r.age;
    this.hitDepthSum += this.depths[i];

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
    const a = this._bucket(key), b = a | 1;
    if (this.keys[a] === key) return this.moves[a];
    if (this.keys[b] === key) return this.moves[b];
    return 0;
  }

  newSearch() {
    this.currentAge = (this.currentAge + 1) & 0xFF;
    this.hits = 0;
    this.misses = 0;
    this.stores = 0;
    this.collisions = 0;
    this.hitAgeSum = 0;
    this.hitDepthSum = 0;
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

  /** Occupancy in permille, estimated from a fixed-size sample. */
  _fillPermille() {
    const sample = Math.min(FILL_SAMPLE, this.size);
    const stride = Math.max(1, Math.floor(this.size / sample));
    let used = 0, seen = 0;
    for (let i = 0; i < this.size; i += stride) {
      if (this.keys[i] !== 0n) used++;
      seen++;
    }
    return seen === 0 ? 0 : Math.round((used / seen) * 1000);
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      stores: this.stores,
      collisions: this.collisions,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(1) + '%' : 'n/a',
      hitAgeAvg:    this.hits > 0 ? +(this.hitAgeSum / this.hits).toFixed(2) : null,
      hitDepthAvg:  this.hits > 0 ? +(this.hitDepthSum / this.hits).toFixed(2) : null,
      fillPermille: this._fillPermille(),
      usage: (this._fillPermille() / 10).toFixed(1) + '%',
    };
  }
}

export default TranspositionTable;