/**
 * Move ordering with typed-array heuristic tables.
 *
 * Allocation profile per orderMoves() call:
 *   - Zero objects when LOG.moveOrder is off
 *   - Mutates the input `moves` array in place and returns it
 *   - All heuristic tables are pre-allocated typed arrays (fixed ~20KB total)
 */

import { PIECE_VALUES, PIECES } from '../core/constants.js';
import { evaluatePawnPush } from '../evaluation/pawnPush.js';
import { encodedMatches } from '../tables/transposition.js';
import { LOG } from '../logging/logger.js';

const MAX_PLY = 128;

export const MOVE_PRIORITY = {
  TT_MOVE:          2_000_000,
  BOOK_MOVE:        1_500_000,   // ← between TT and everything else
  PROMOTION_QUEEN:  1_200_000,
  PROMOTION_OTHER:  1_100_000,
  WINNING_CAPTURE:  1_000_000,
  KILLER_MOVE_1:      900_000,
  KILLER_MOVE_2:      850_000,
  COUNTER_MOVE:       800_000,
  EQUAL_CAPTURE:      700_000,
  PAWN_DOUBLE_PUSH:   600_000,
  LOSING_CAPTURE:     500_000,
  HISTORY_BASE:             0,
};

// Polyglot weights cap at 65535. Scale so max weight adds ~100K — enough
// to order within the book tier, not enough to jump tiers.
const BOOK_WEIGHT_SCALE = 2;

// ─────────────────────────────────────────────────────────────────────────────
// MVV-LVA — no state, so just a free function
// ─────────────────────────────────────────────────────────────────────────────
function mvvLvaScore(move) {
  const victim = PIECE_VALUES[move.capturedPiece] || 0;
  const attacker = PIECE_VALUES[move.piece] || 0;
  const delta = victim * 10 - attacker;
  if (delta > 0)   return MOVE_PRIORITY.WINNING_CAPTURE + delta;
  if (delta === 0) return MOVE_PRIORITY.EQUAL_CAPTURE;
  return MOVE_PRIORITY.LOSING_CAPTURE + delta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Killer moves — two per ply, stored as encoded ints (from<<6 | to).
// Int32Array of size MAX_PLY*2 = 256 ints = 1KB.
// ─────────────────────────────────────────────────────────────────────────────
export class KillerMoveTable {
  constructor() {
    this.killers = new Int32Array(MAX_PLY * 2);
  }

  _encode(move) {
    // 12-bit encoding is sufficient here; we only compare, never decode.
    return (move.fromSquare << 6) | move.toSquare;
  }

  getScore(move, ply) {
    if (ply >= MAX_PLY) return 0;
    const enc = this._encode(move);
    const base = ply << 1;
    if (this.killers[base]     === enc) return MOVE_PRIORITY.KILLER_MOVE_1;
    if (this.killers[base + 1] === enc) return MOVE_PRIORITY.KILLER_MOVE_2;
    return 0;
  }

  add(move, ply) {
    if (move.capturedPiece !== null || ply >= MAX_PLY) return;
    const enc = this._encode(move);
    const base = ply << 1;
    if (this.killers[base] === enc) return;   // already primary
    // Shift: old primary → secondary, new → primary
    this.killers[base + 1] = this.killers[base];
    this.killers[base] = enc;
  }

  clear() { this.killers.fill(0); }
}

// ─────────────────────────────────────────────────────────────────────────────
// History heuristic — indexed by [from*64 + to].
// Int32Array of 4096 ints = 16KB. No string concat, no object keys.
// ─────────────────────────────────────────────────────────────────────────────
export class HistoryTable {
  constructor() {
    this.h = new Int32Array(64 * 64);
    this.maxValue = 8000;
  }

  getScore(move) {
    return this.h[(move.fromSquare << 6) | move.toSquare];
  }

  update(move, depth, isGoodMove) {
    if (move.capturedPiece !== null) return;
    const idx = (move.fromSquare << 6) | move.toSquare;
    const bonus = depth * depth;
    if (isGoodMove) {
      const v = this.h[idx] + bonus;
      this.h[idx] = v > this.maxValue ? this.maxValue : v;
    } else {
      const v = this.h[idx] - (bonus >> 1);
      this.h[idx] = v < 0 ? 0 : v;
    }
  }

  /** Halve all entries — single typed-array pass, ~4K iterations. */
  age() {
    const h = this.h;
    for (let i = 0; i < h.length; i++) h[i] >>= 1;
  }

  clear() { this.h.fill(0); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Counter-move — indexed by [piece*64 + toSquare] of the TRIGGERING move.
// Stores the encoded counter. 6 piece types × 64 squares = 384 ints ≈ 1.5KB.
// ─────────────────────────────────────────────────────────────────────────────
export class CounterMoveTable {
  constructor() {
    // 7 slots to handle PIECES.NONE or off-by-one enum ranges safely.
    this.t = new Int32Array(7 * 64);
  }

  getEncoded(lastMove) {
    if (!lastMove) return 0;
    return this.t[lastMove.piece * 64 + lastMove.toSquare];
  }

  matches(encoded, move) {
    return encoded !== 0 &&
           (encoded >>> 6) === move.fromSquare &&
           (encoded & 0x3F) === move.toSquare;
  }

  update(lastMove, counterMove) {
    if (!lastMove || counterMove.capturedPiece !== null) return;
    const enc = (counterMove.fromSquare << 6) | counterMove.toSquare;
    this.t[lastMove.piece * 64 + lastMove.toSquare] = enc;
  }

  clear() { this.t.fill(0); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main orderer
// ─────────────────────────────────────────────────────────────────────────────
export class MoveOrderer {
  constructor(config = {}) {
    this.killers  = config.useKillerMoves      !== false ? new KillerMoveTable()  : null;
    this.history  = config.useHistoryHeuristic !== false ? new HistoryTable()     : null;
    this.counters = new CounterMoveTable();
    this.usePawnPush = config.usePawnPush !== false;
  }

  /**
   * Order moves in place. Returns the SAME array reference.
   *
   * @param {Array}       moves      Legal moves — mutated in place
   * @param {number}      ply        Search ply
   * @param {Board}       board
   * @param {string}      color
   * @param {number}      ttMove     Encoded TT move (integer), or 0
   * @param {Object|null} lastMove   Previous move (for counter-move lookup)
   * @param {Map|null}    bookHints  Map<algebraic, weight> — root only
   */
  orderMoves(moves, ply, board, color, ttMove = 0, lastMove = null, bookHints = null) {
    // scoreBreakdown is a debugging aid. Only build it when someone will
    // actually read it — otherwise it's a per-move object allocation that
    // gets retained by the TT (via bestMove reference in the old design).
    const wantBreakdown = LOG.moveOrder;

    // Decode counter-move once, outside the loop.
    const counterEnc = this.counters.getEncoded(lastMove);

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      let score = 0;
      let breakdown = null;
      if (wantBreakdown) breakdown = {};

      // Reset ordering annotations from prior iterations. Without this,
      // flags from a previous depth's ordering leak into the next.
      move.isTTMove = false;
      move.isKiller = false;
      move.isCounterMove = false;
      move.isBookMove = false;

      // ── TT move — highest tier, it's proven by prior search ──
      if (ttMove !== 0 && encodedMatches(ttMove, move)) {
        score = MOVE_PRIORITY.TT_MOVE;
        move.isTTMove = true;
        if (breakdown) breakdown.tt = score;
      }
      // ── Book move — searched early, but TT (actual search evidence) beats it.
      //    When a book line is bad, a depth-N search produces a TT entry for
      //    a better move; at depth N+1 that TT move outranks the book hint,
      //    naturally escaping the bad line. ──
      else if (bookHints && bookHints.has(move.algebraic)) {
        const weight = bookHints.get(move.algebraic);
        score = MOVE_PRIORITY.BOOK_MOVE + weight * BOOK_WEIGHT_SCALE;
        move.isBookMove = true;
        if (breakdown) breakdown.book = score;
      }
      // ── Promotions ──
      else if (move.isPromotion) {
        score = move.promotionPiece === PIECES.QUEEN
          ? MOVE_PRIORITY.PROMOTION_QUEEN
          : MOVE_PRIORITY.PROMOTION_OTHER;
        if (breakdown) breakdown.promo = score;
      }
      // ── Captures ──
      else if (move.capturedPiece !== null) {
        score = mvvLvaScore(move);
        if (breakdown) breakdown.capture = score;
      }
      // ── Quiet moves: killers → counter → history → pawn push ──
      else {
        if (this.killers) {
          const ks = this.killers.getScore(move, ply);
          if (ks > 0) { score = ks; move.isKiller = true; if (breakdown) breakdown.killer = ks; }
        }
        if (score === 0 && this.counters.matches(counterEnc, move)) {
          score = MOVE_PRIORITY.COUNTER_MOVE;
          move.isCounterMove = true;
          if (breakdown) breakdown.counter = score;
        }
        if (score === 0 && this.history) {
          const hs = this.history.getScore(move);
          if (hs > 0) { score = hs; if (breakdown) breakdown.history = hs; }
        }
        if (score === 0 && this.usePawnPush && move.piece === PIECES.PAWN) {
          const pb = evaluatePawnPush(move, board, color);
          if (pb > 0) { score = MOVE_PRIORITY.PAWN_DOUBLE_PUSH + pb; if (breakdown) breakdown.pawnPush = score; }
        }
      }

      move.orderScore = score;
      if (breakdown) move.scoreBreakdown = breakdown;
    }

    // In-place sort — no new array.
    moves.sort((a, b) => b.orderScore - a.orderScore);
    return moves;
  }

  addKiller(move, ply)            { this.killers?.add(move, ply); }
  updateHistory(move, depth, ok)  { this.history?.update(move, depth, ok); }
  updateCounterMove(last, good)   { this.counters.update(last, good); }
  prepareNewSearch()              { this.history?.age(); }

  clear() {
    this.killers?.clear();
    this.history?.clear();
    this.counters.clear();
  }
}

export default MoveOrderer;