/**
 * Move ordering.
 *
 * Tiers (coarse, binary facts about a move):
 *
 *   TT_MOVE          2_000_000
 *   BOOK_MOVE        1_500_000   (+1000 for the sampled pick — see search.js)
 *   PROMOTION_QUEEN  1_200_000
 *   WINNING_CAPTURE  1_000_000   + mvvLva (0..23_300)
 *   PROMOTION_OTHER    950_000
 *   KILLER_MOVE_1      900_000
 *   KILLER_MOVE_2      850_000
 *   COUNTER_MOVE       800_000
 *   EQUAL_CAPTURE      700_000   + mvvLva
 *   LOSING_CAPTURE     500_000   + see (negative)
 *   quiet                    0   + history + 4·pstDelta + 2·pushBonus
 *
 * Every tier is ≥ 50_000 apart, and the soft-pin penalty is bounded at 400, so
 * the penalty can reorder within a tier but can never cross one.
 *
 * REMOVED: the PAWN_DOUBLE_PUSH tier at 600_000. It sat above LOSING_CAPTURE
 * and above every history move (the old code only consulted history when the
 * score was still 0, and only consulted the push bonus when history had also
 * returned 0). A fresh `h2h4` outranked a quiet move that had caused a
 * thousand beta cutoffs, and d4/e4 were pinned near the top of every opening
 * position in every game.
 *
 * Allocation profile: zero objects when LOG.moveOrder is off. All heuristic
 * tables are pre-allocated typed arrays (~20KB total).
 */
import { PIECE_VALUES, PIECES, WHITE_IDX, BLACK_IDX } from '../core/constants.js';
import { evaluatePawnPush } from '../evaluation/pawnPush.js';
import { getPSTValue } from '../evaluation/pieceSquareTables.js';
import { encodedMatches } from '../tables/transposition.js';
import { seeFast } from './see.js';
import { hasBit, colorToIndex } from '../core/bitboard.js';
import {
  ANALYSIS, softPinPartner, softPinStaysOnLine, softPinIsDiagonal,
} from '../core/moveGeneration.js';
import logger, { LOG, CAT } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;
const MAX_PLY = 128;

export const MOVE_PRIORITY = {
  TT_MOVE:          2_000_000,
  BOOK_MOVE:        1_500_000,
  PROMOTION_QUEEN:  1_200_000,
  WINNING_CAPTURE:  1_000_000,
  PROMOTION_OTHER:    950_000,
  KILLER_MOVE_1:      900_000,
  KILLER_MOVE_2:      850_000,
  COUNTER_MOVE:       800_000,
  EQUAL_CAPTURE:      700_000,
  LOSING_CAPTURE:     500_000,
  QUIET_BASE:               0,
};

const BOOK_WEIGHT_SCALE = 2;
const BOOK_PICK_BONUS   = 1000;
const PST_ORDER_SCALE   = 4;
const PUSH_ORDER_SCALE  = 2;
const PROMO_MVV_BONUS   = 8000;

/** Intra-tier key. MVV dominates; LVA breaks ties toward the cheapest attacker. */
function mvvLvaKey(move) {
  const victim = PIECE_VALUES[move.capturedPiece] ?? 0;
  const attacker = PIECE_VALUES[move.piece] ?? 0;
  let k = victim * 16 + (PIECE_VALUES[PIECES.QUEEN] - attacker);
  if (move.isPromotion) k += PROMO_MVV_BONUS;   // axb8=Q must outrank QxR
  return k;
}

// ═══════════════════════════════════════════════════════════════════════════
// Soft-pin risk — "which of the two blockers should take the pin?"
//
// A pin hurts exactly as much as the pinned piece's mobility loss. A rook
// pinned along a file still rakes the file; a rook pinned along a diagonal is
// a spectator. Knights are frozen on every ray. Pawns are nearly free to pin
// (they push along files anyway). The queen is never frozen, but confining the
// board's only omnidirectional attacker to one line is the largest loss there
// is, so she is always the worst candidate.
//
// The residual R-vs-B ambiguity (both frozen) is where board state enters:
// a frozen rook costs more when files are open, a frozen bishop when the long
// diagonals are. Both counts are computed once per node, and only when a soft
// pin actually exists — which is rare.
// ═══════════════════════════════════════════════════════════════════════════
const FILE_LO = new Int32Array(8), FILE_HI = new Int32Array(8);
let DIAG_A1H8_LO = 0, DIAG_A1H8_HI = 0, DIAG_A8H1_LO = 0, DIAG_A8H1_HI = 0;
{
  const set = (sq, lo, hi) => sq < 32 ? [lo | (1 << sq), hi] : [lo, hi | (1 << (sq - 32))];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const sq = (r << 3) | f;
      if (sq < 32) FILE_LO[f] |= (1 << sq); else FILE_HI[f] |= (1 << (sq - 32));
    }
  }
  for (let i = 0; i < 8; i++) {
    [DIAG_A1H8_LO, DIAG_A1H8_HI] = set(i * 9, DIAG_A1H8_LO, DIAG_A1H8_HI);
    [DIAG_A8H1_LO, DIAG_A8H1_HI] = set(7 + i * 7, DIAG_A8H1_LO, DIAG_A8H1_HI);
  }
}

/** Risk of leaving `piece` pinned on a ray. Higher = avoid pinning this piece. */
function pinRisk(piece, diagonalRay, openFiles, openDiags) {
  switch (piece) {
    case PIECES.PAWN:   return diagonalRay ? 10 : 0;     // pushes along a file regardless
    case PIECES.KNIGHT: return 140;                       // frozen on every ray
    case PIECES.BISHOP: return diagonalRay ? 60  : 170 + 6 * openDiags;
    case PIECES.ROOK:   return diagonalRay ? 210 + 6 * openFiles : 70;
    case PIECES.QUEEN:  return 360;
    default:            return 0;                         // the king is the ray endpoint
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Killers — two per ply, encoded ints (from<<6 | to). Int32Array, 1KB.
// ═══════════════════════════════════════════════════════════════════════════
export class KillerMoveTable {
  constructor() { this.killers = new Int32Array(MAX_PLY * 2); }
  _encode(move) { return (move.fromSquare << 6) | move.toSquare; }

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
    if (this.killers[base] === enc) return;
    this.killers[base + 1] = this.killers[base];
    this.killers[base] = enc;
  }

  clear() { this.killers.fill(0); }
}

// ═══════════════════════════════════════════════════════════════════════════
// History — [from*64 + to], Int32Array 16KB, gravity update.
//
// The old hard clamp at maxValue let a single hot move saturate and then stop
// discriminating. Gravity (`h += bonus - h*|bonus|/MAX`) is self-normalising:
// a move near the ceiling gains almost nothing from another success.
// ═══════════════════════════════════════════════════════════════════════════
const HISTORY_MAX = 8192;

export class HistoryTable {
  constructor() { this.h = new Int32Array(64 * 64); }
  getScore(move) { return this.h[(move.fromSquare << 6) | move.toSquare]; }

  update(move, depth, isGoodMove) {
    if (move.capturedPiece !== null) return;
    const idx = (move.fromSquare << 6) | move.toSquare;
    const raw = depth * depth;
    const bonus = isGoodMove ? (raw > 400 ? 400 : raw) : -((raw > 400 ? 400 : raw) >> 1);
    const h = this.h[idx];
    this.h[idx] = h + bonus - ((h * (bonus < 0 ? -bonus : bonus)) / HISTORY_MAX | 0);
  }

  age()   { const h = this.h; for (let i = 0; i < h.length; i++) h[i] >>= 1; }
  clear() { this.h.fill(0); }
}

// ═══════════════════════════════════════════════════════════════════════════
// Counter-moves — [(colorOfLastMover*6 + piece)*64 + to].
//
// The old index omitted the colour, so white's and black's replies shared
// slots whenever the to-square coincided, poisoning both.
// ═══════════════════════════════════════════════════════════════════════════
export class CounterMoveTable {
  constructor() { this.t = new Int32Array(12 * 64); }
  _index(lastMoverIdx, lastMove) { return ((lastMoverIdx * 6 + lastMove.piece) << 6) | lastMove.toSquare; }

  getEncoded(lastMove, lastMoverIdx) {
    if (!lastMove || lastMove.piece === PIECES.NONE) return 0;
    return this.t[this._index(lastMoverIdx, lastMove)];
  }

  matches(encoded, move) {
    return encoded !== 0 &&
           (encoded >>> 6) === move.fromSquare &&
           (encoded & 0x3F) === move.toSquare;
  }

  update(lastMove, lastMoverIdx, counterMove) {
    if (!lastMove || lastMove.piece === PIECES.NONE || counterMove.capturedPiece !== null) return;
    this.t[this._index(lastMoverIdx, lastMove)] = (counterMove.fromSquare << 6) | counterMove.toSquare;
  }

  clear() { this.t.fill(0); }
}

// ═══════════════════════════════════════════════════════════════════════════
export class MoveOrderer {
  constructor(config = {}) {
    this.killers  = config.useKillerMoves      !== false ? new KillerMoveTable() : null;
    this.history  = config.useHistoryHeuristic !== false ? new HistoryTable()    : null;
    this.counters = new CounterMoveTable();
    this.usePawnPush = config.usePawnPush !== false;
    this.useSoftPin  = config.useSoftPinOrdering !== false;
    // Pre-allocated, fixed shape. scoreMoves is not reentrant.
    this._ctx = { ply: 0, color: 'white', isWhite: true, phase: 1, ttMove: 0,
                  counterEnc: 0, bookHints: null, bookPick: null,
                  softActive: false, openFiles: 0, openDiags: 0 };
  }

  _prepareContext(ctx, board, color, ply, ttMove, lastMove, bookHints, bookPick) {
    const usIdx = colorToIndex(color);
    ctx.ply = ply; ctx.color = color; ctx.isWhite = usIdx === WHITE_IDX;
    ctx.phase = this._phase(board);
    ctx.ttMove = ttMove;
    ctx.counterEnc = this.counters.getEncoded(lastMove, usIdx ^ 1);
    ctx.bookHints = bookHints; ctx.bookPick = bookPick;
    // ANALYSIS is published by the generator for THIS position. A key mismatch
    // means something regenerated in between; skip the term rather than score
    // against a stale board.
    ctx.softActive = this.useSoftPin &&
                     (ANALYSIS.softLo | ANALYSIS.softHi) !== 0 &&
                     ANALYSIS.key === board.gameState.zobristKey;
    ctx.openFiles = ctx.softActive ? this._openFiles(board) : 0;
    ctx.openDiags = ctx.softActive ? this._openDiags(board) : 0;
  }
  
  _scoreOne(move, ctx, board) {
    const penalty = this._softPinPenalty(move, ctx, board);
    if (ctx.ttMove !== 0 && encodedMatches(ctx.ttMove, move)) {
      move.isTTMove = true;
      move.orderScore = MOVE_PRIORITY.TT_MOVE;          // not negotiable
      return;
    }
    if (ctx.bookHints !== null && ctx.bookHints.has(move.algebraic)) {
      move.isBookMove = true;
      move.orderScore = MOVE_PRIORITY.BOOK_MOVE + ctx.bookHints.get(move.algebraic) * BOOK_WEIGHT_SCALE
                      + (move.algebraic === ctx.bookPick ? BOOK_PICK_BONUS : 0);
      return;
    }
    if (move.isPromotion && move.promotionPiece === PIECES.QUEEN) {
      move.orderScore = MOVE_PRIORITY.PROMOTION_QUEEN - penalty;
      return;
    }
    if (move.capturedPiece !== null) {
      move.orderScore = this._captureScore(move, board) - penalty;
      return;
    }
    if (move.isPromotion) {
      move.orderScore = MOVE_PRIORITY.PROMOTION_OTHER - penalty;
      return;
    }
    move.orderScore = this._quietScore(move, ctx, board) - penalty;
  }

  /** SEE picks the tier; MVV-LVA orders within it. */
  _captureScore(move, board) {
    const s = seeFast(board, move);
    move.seeScore = s;
    if (s > 0)  return MOVE_PRIORITY.WINNING_CAPTURE + mvvLvaKey(move);
    if (s === 0) return MOVE_PRIORITY.EQUAL_CAPTURE + mvvLvaKey(move);
    return MOVE_PRIORITY.LOSING_CAPTURE + s;           // worst losses last
  }

  _quietScore(move, ctx, board) {
    if (this.killers) {
      const ks = this.killers.getScore(move, ctx.ply);
      if (ks > 0) { move.isKiller = true; return ks; }
    }
    if (this.counters.matches(ctx.counterEnc, move)) {
      move.isCounterMove = true;
      return MOVE_PRIORITY.COUNTER_MOVE;
    }
    // History + positional signal, ADDED (the old cascade made them exclusive,
    // so a fresh pawn push outranked a move that had caused 1000 cutoffs).
    let q = this.history ? this.history.getScore(move) : 0;
    q += (getPSTValue(move.piece, move.toSquare, ctx.isWhite, ctx.phase)
        - getPSTValue(move.piece, move.fromSquare, ctx.isWhite, ctx.phase)) * PST_ORDER_SCALE;
    if (this.usePawnPush && move.piece === PIECES.PAWN) {
      q += evaluatePawnPush(move, board, ctx.color) * PUSH_ORDER_SCALE;
    }
    return MOVE_PRIORITY.QUIET_BASE + q;
  }

  /**
   * Leaving a two-blocker line pins our partner. How much that costs decides
   * which of the two blockers we would rather move first. Bounded at ~400, and
   * every tier is ≥ 50_000 apart, so this reorders within a tier and never
   * across one.
   */
  _softPinPenalty(move, ctx, board) {
    if (!ctx.softActive) return 0;
    if (!hasBit(ANALYSIS.softLo, ANALYSIS.softHi, move.fromSquare)) return 0;
    if (softPinStaysOnLine(move.fromSquare, move.toSquare)) return 0;
    const partner = softPinPartner(move.fromSquare);
    return pinRisk(board.pieceList[partner], softPinIsDiagonal(move.fromSquare), ctx.openFiles, ctx.openDiags);
  }

  scoreMoves(moves, ply, board, color, ttMove = 0, lastMove = null, bookHints = null, bookPick = null) {
    const ctx = this._ctx;
    this._prepareContext(ctx, board, color, ply, ttMove, lastMove, bookHints, bookPick);
    for (let i = 0; i < moves.length; i++) this._scoreOne(moves[i], ctx, board);
    return moves;
  }

  _phase(board) {
    const w = board.bbPieces[WHITE_IDX], b = board.bbPieces[BLACK_IDX];
    const p = (w[PIECES.KNIGHT].popCount() + b[PIECES.KNIGHT].popCount())
            + (w[PIECES.BISHOP].popCount() + b[PIECES.BISHOP].popCount())
            + (w[PIECES.ROOK  ].popCount() + b[PIECES.ROOK  ].popCount()) * 2
            + (w[PIECES.QUEEN ].popCount() + b[PIECES.QUEEN ].popCount()) * 4;
    return p >= 24 ? 1 : p / 24;
  }

  _openFiles(board) {
    const wp = board.bbPieces[WHITE_IDX][PIECES.PAWN], bp = board.bbPieces[BLACK_IDX][PIECES.PAWN];
    const lo = (wp.low | bp.low) | 0, hi = (wp.high | bp.high) | 0;
    let n = 0;
    for (let f = 0; f < 8; f++) if (((lo & FILE_LO[f]) | (hi & FILE_HI[f])) === 0) n++;
    return n;
  }

  _openDiags(board) {
    const wp = board.bbPieces[WHITE_IDX][PIECES.PAWN], bp = board.bbPieces[BLACK_IDX][PIECES.PAWN];
    const lo = (wp.low | bp.low) | 0, hi = (wp.high | bp.high) | 0;
    let n = 0;
    if (((lo & DIAG_A1H8_LO) | (hi & DIAG_A1H8_HI)) === 0) n += 4;
    if (((lo & DIAG_A8H1_LO) | (hi & DIAG_A8H1_HI)) === 0) n += 4;
    return n;
  }

 

  /** Full sort. Root only (the collector and book assertions need it). */
  sortMoves(moves) {
    moves.sort((a, b) => b.orderScore - a.orderScore);
    return moves;
  }

  /** Back-compat: score + sort. Used by the root and by test introspection. */
  orderMoves(moves, ply, board, color, ttMove = 0, lastMove = null, bookHints = null, bookPick = null) {
    this.scoreMoves(moves, ply, board, color, ttMove, lastMove, bookHints, bookPick);
    return this.sortMoves(moves);
  }

  addKiller(move, ply)                 { this.killers?.add(move, ply); }
  updateHistory(move, depth, ok)       { this.history?.update(move, depth, ok); }
  updateCounterMove(last, lastIdx, ok) { this.counters.update(last, lastIdx, ok); }
  prepareNewSearch()                   { this.history?.age(); }
  clear() { this.killers?.clear(); this.history?.clear(); this.counters.clear(); }
}

/**
 * Selection sort step: swap the highest-scoring remaining move into slot `i`.
 *
 * A cut node searches 1–3 moves; a full sort of 35 is ~180 comparisons wasted.
 * This pays O(n) per move actually searched. Swapping entries of `slot.list` is
 * safe — `slot.objs` owns the move objects and is indexed separately.
 */
export function pickMove(moves, i) {
  let best = i, bestScore = moves[i].orderScore;
  for (let j = i + 1; j < moves.length; j++) {
    if (moves[j].orderScore > bestScore) { best = j; bestScore = moves[j].orderScore; }
  }
  if (best !== i) { const t = moves[i]; moves[i] = moves[best]; moves[best] = t; }
  return moves[i];
}

export default MoveOrderer;