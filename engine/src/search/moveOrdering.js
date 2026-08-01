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
import { seeFast } from './see.js';
import { LOG } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;
const MAX_PLY = 128;

export const MOVE_PRIORITY = {
  TT_MOVE:          2_000_000,
  BOOK_MOVE:        1_500_000,
  PROMOTION_QUEEN:  1_200_000,
  WINNING_CAPTURE:  1_000_000,
  PROMOTION_OTHER:    950_000,   // ← below winning captures; see note
  KILLER_MOVE_1:      900_000,
  KILLER_MOVE_2:      850_000,
  COUNTER_MOVE:       800_000,
  EQUAL_CAPTURE:      700_000,
  PAWN_DOUBLE_PUSH:   600_000,
  LOSING_CAPTURE:     500_000,
  HISTORY_BASE:             0,
};

const BOOK_WEIGHT_SCALE = 2;

/**
 * Intra-tier ordering key. MVV dominates (victim × 16); LVA breaks ties by
 * preferring the cheapest attacker.
 *
 * This is ONLY a sort key — it no longer decides the tier. The old code used
 * `victim*10 - attacker > 0` to pick the tier, and since victim*10 >= 1000 >
 * any attacker value, that test was always true: every capture landed in
 * WINNING_CAPTURE, above killers and counter-moves, and the EQUAL_CAPTURE and
 * LOSING_CAPTURE tiers were unreachable dead code. A queen grabbing a defended
 * pawn was searched before a quiet move that won a piece.
 */
function mvvLvaKey(move) {
  const victim = PIECE_VALUES[move.capturedPiece] ?? 0;
  const attacker = PIECE_VALUES[move.piece] ?? 0;
  return victim * 16 + (PIECE_VALUES[PIECES.QUEEN] - attacker);
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
    this.killers  = config.useKillerMoves      !== false ? new KillerMoveTable() : null;
    this.history  = config.useHistoryHeuristic !== false ? new HistoryTable()    : null;
    this.counters = new CounterMoveTable();
    this.usePawnPush = config.usePawnPush !== false;
  }
  orderMoves(moves, ply, board, color, ttMove = 0, lastMove = null, bookHints = null) {
    const wantBreakdown = __LOG__ && LOG.moveOrder;
    const counterEnc = this.counters.getEncoded(lastMove);
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      let score = 0;
      const breakdown = wantBreakdown ? {} : null;
      // Annotations are reset by the generator now, not here.
      if (ttMove !== 0 && encodedMatches(ttMove, move)) {
        score = MOVE_PRIORITY.TT_MOVE;
        move.isTTMove = true;
        if (breakdown) breakdown.tt = score;
      }
      else if (bookHints && bookHints.has(move.algebraic)) {
        score = MOVE_PRIORITY.BOOK_MOVE + bookHints.get(move.algebraic) * BOOK_WEIGHT_SCALE;
        move.isBookMove = true;
        if (breakdown) breakdown.book = score;
      }
      // Queen promotions jump the queue. Under-promotions are almost always
      // wrong, so they sit BELOW winning captures instead of above them — the
      // old PROMOTION_OTHER tier (1.1M) searched =R/=B/=N before every capture
      // in the position, which is 3 wasted full-depth searches per promotion.
      else if (move.isPromotion && move.promotionPiece === PIECES.QUEEN) {
        score = MOVE_PRIORITY.PROMOTION_QUEEN;
        if (breakdown) breakdown.promo = score;
      }
      else if (move.capturedPiece !== null) {
        // SEE decides the tier; MVV-LVA orders within it.
        const s = seeFast(board, move);
        move.seeScore = s;
        if (s > 0)        score = MOVE_PRIORITY.WINNING_CAPTURE + mvvLvaKey(move);
        else if (s === 0) score = MOVE_PRIORITY.EQUAL_CAPTURE + mvvLvaKey(move);
        else              score = MOVE_PRIORITY.LOSING_CAPTURE + s;   // worst losses last
        if (breakdown) { breakdown.capture = score; breakdown.see = s; }
      }
      else if (move.isPromotion) {
        score = MOVE_PRIORITY.PROMOTION_OTHER;
        if (breakdown) breakdown.promo = score;
      }
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
    moves.sort((a, b) => b.orderScore - a.orderScore);
    return moves;
  }
  addKiller(move, ply)           { this.killers?.add(move, ply); }
  updateHistory(move, depth, ok) { this.history?.update(move, depth, ok); }
  updateCounterMove(last, good)  { this.counters.update(last, good); }
  prepareNewSearch()             { this.history?.age(); }
  clear() { this.killers?.clear(); this.history?.clear(); this.counters.clear(); }
}

export default MoveOrderer;