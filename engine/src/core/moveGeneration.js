/**
 * Legal move generation — legal by construction, no make/unmake.
 *
 * Per node we build, once:
 *   attLo/attHi   squares attacked by the opponent, OUR KING LIFTED off the
 *                 occupancy so slider rays run through it
 *   checkLo/Hi    the pieces currently checking our king (real occupancy)
 *   capLo/pushLo  capture + push masks (FULL when not in check)
 *   pinnedLo/Hi   absolutely pinned friendly pieces
 *   PIN_LO/PIN_HI per-square legal ray for each pinned piece
 *
 * Then every move is emitted with its target set already intersected against
 * those masks. A move that leaves the king in check is never constructed.
 *
 * Double check exits after king moves: nothing else can ever be legal.
 *
 * NOT REENTRANT. The analysis lives in module-level scalars and generateMoves
 * does not recurse (it no longer calls makeMove). Two interleaved generations
 * would clobber each other — the engine is single-threaded and synchronous.
 */
import { PIECES, CASTLING, WHITE_IDX } from './constants.js';
import {
  colorToIndex, indexToSquare, BitBoardIterator,
  FULL, bitLo, bitHi, hasBit, lsb64, popCount64, isSingleBit,
} from './bitboard.js';
import {
  KN_LO, KN_HI, KG_LO, KG_HI, PA_LO, PA_HI, BTW_LO, BTW_HI,
  RRAY_LO, RRAY_HI, BRAY_LO, BRAY_HI,
  rookAttacks, bishopAttacks, SLIDE,
  computeAttackSet, ATTACKS, attackersToSquare, ATTACKERS,
  squareAttackedBy, sliderAttacksKing,
} from './attacks.js';
import logger, { LOG, CAT } from '../logging/logger.js';
const __LOG__ = globalThis.__LOG__ ?? true;

// ═══════════════════════════════════════════════════════════════════════════
// Legacy square-list tables. see.js walks these; the generator itself uses the
// bitboard forms in attacks.js.
// ═══════════════════════════════════════════════════════════════════════════
export const KNIGHT_ATTACKS = new Array(64);
export const KING_ATTACKS   = new Array(64);
{
  const KNIGHT_D = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const KING_D   = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
  const build = (sq, deltas) => {
    const r = sq >> 3, f = sq & 7, out = [];
    for (const [dr, df] of deltas) {
      const nr = r + dr, nf = f + df;
      if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) out.push((nr << 3) | nf);
    }
    return Uint8Array.from(out);
  };
  for (let sq = 0; sq < 64; sq++) {
    KNIGHT_ATTACKS[sq] = build(sq, KNIGHT_D);
    KING_ATTACKS[sq]   = build(sq, KING_D);
  }
}
export const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const DIAG  = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

const PROMO_SUFFIX = ['', 'q', 'r', 'b', 'n'];
const PROMO_ORDER  = [PIECES.QUEEN, PIECES.ROOK, PIECES.BISHOP, PIECES.KNIGHT];

// ═══════════════════════════════════════════════════════════════════════════
// Per-node analysis state (module-static — see header)
// ═══════════════════════════════════════════════════════════════════════════
const PIN_LO = new Int32Array(64);
const PIN_HI = new Int32Array(64);
// ── Soft pins ──────────────────────────────────────────────────────────────
// A line from an enemy slider to our king holding EXACTLY TWO friendly
// blockers. Neither is pinned — remove one and the other still interposes —
// but the moment either steps off the line, the other is absolutely pinned.
//
// Which one should take that risk is a move-ordering question, so the
// generator only records the facts: for each blocker, its partner, the line it
// must stay on to avoid creating the pin (including the pinner's square, since
// capturing the pinner dissolves the line), and whether the ray is diagonal
// (which determines whether the partner would still be mobile while pinned).
//
// Three or more blockers record nothing: removing one leaves two.
const SOFT_PARTNER = new Int8Array(64);
const SOFT_LINE_LO = new Int32Array(64);
const SOFT_LINE_HI = new Int32Array(64);
const SOFT_DIAG    = new Uint8Array(64);
const SOFT_PAIR    = new Int8Array(2);

let _pcLo = 0, _pcHi = 0;
let pinnedLo = 0, pinnedHi = 0;
let softLo   = 0, softHi   = 0;
let checkLo  = 0, checkHi  = 0, checkCount = 0;
let capLo = FULL, capHi = FULL, pushLo = FULL, pushHi = FULL;
let attLo = 0, attHi = 0;
/**
 * Published analysis for the position that was last generated. Move ordering
 * reads this immediately after generateMoves() for the same position; `key`
 * lets it detect staleness and silently skip the soft-pin term rather than
 * score against a different board.
 */
export const ANALYSIS = {
  key: 0n, checkCount: 0,
  pinnedLo: 0, pinnedHi: 0,
  softLo: 0, softHi: 0,
};
export function softPinPartner(sq)        { return SOFT_PARTNER[sq]; }
export function softPinStaysOnLine(sq, to){ return hasBit(SOFT_LINE_LO[sq], SOFT_LINE_HI[sq], to); }
export function softPinIsDiagonal(sq)     { return SOFT_DIAG[sq] !== 0; }
const IT_PIECE  = new BitBoardIterator();
const IT_TARGET = new BitBoardIterator();
const IT_SCAN   = new BitBoardIterator();
const IT_PAIR   = new BitBoardIterator();

// ═══════════════════════════════════════════════════════════════════════════
// Attack / check queries (public)
// ═══════════════════════════════════════════════════════════════════════════
export function isSquareAttacked(board, square, byColor) {
  const occLo = (board.bbSide[0].low  | board.bbSide[1].low)  | 0;
  const occHi = (board.bbSide[0].high | board.bbSide[1].high) | 0;
  return squareAttackedBy(board, square, colorToIndex(byColor), occLo, occHi);
}

export function isInCheck(board, color) {
  const us = colorToIndex(color);
  const ksq = board.bbPieces[us][PIECES.KING].getLSB();
  if (ksq < 0) return false;
  const occLo = (board.bbSide[0].low  | board.bbSide[1].low)  | 0;
  const occHi = (board.bbSide[0].high | board.bbSide[1].high) | 0;
  return squareAttackedBy(board, ksq, us ^ 1, occLo, occHi);
}

// ═══════════════════════════════════════════════════════════════════════════
// Move slots (unchanged semantics)
// ═══════════════════════════════════════════════════════════════════════════
const POOL = new Array(256);
export function listForPly(ply) {
  if (ply >= 256) return freshList();
  let slot = POOL[ply];
  if (slot === undefined) slot = POOL[ply] = { objs: [], list: [] };
  return slot;
}
export function freshList() { return { objs: [], list: [] }; }

function blankMove() {
  return {
    fromSquare: 0, toSquare: 0, piece: PIECES.NONE,
    capturedPiece: null, isEnPassant: false,
    isPromotion: false, promotionPiece: null,
    algebraic: null,
    orderScore: 0, seeScore: 0,
    isTTMove: false, isKiller: false, isCounterMove: false, isBookMove: false,
  };
}

export function moveAlgebraic(move) {
  if (move.algebraic !== null) return move.algebraic;
  return indexToSquare(move.fromSquare) + indexToSquare(move.toSquare) +
         (move.promotionPiece !== null ? PROMO_SUFFIX[move.promotionPiece] : '');
}

function emit(slot, from, to, piece, captured, isEnPassant, promo, withAlg) {
  const i = slot.list.length;
  let m = slot.objs[i];
  if (m === undefined) m = slot.objs[i] = blankMove();
  m.fromSquare = from; m.toSquare = to; m.piece = piece;
  m.capturedPiece = captured; m.isEnPassant = isEnPassant;
  m.isPromotion = promo !== null; m.promotionPiece = promo;
  m.algebraic = withAlg
    ? indexToSquare(from) + indexToSquare(to) + (promo !== null ? PROMO_SUFFIX[promo] : '')
    : null;
  m.orderScore = 0; m.seeScore = 0;
  m.isTTMove = false; m.isKiller = false; m.isCounterMove = false; m.isBookMove = false;
  slot.list.push(m);
  return m;
}

function addMove(slot, from, to, piece, captured, isEnPassant, promoting, withAlg) {
  if (promoting) {
    for (let i = 0; i < 4; i++) emit(slot, from, to, piece, captured, false, PROMO_ORDER[i], withAlg);
  } else {
    emit(slot, from, to, piece, captured, isEnPassant, null, withAlg);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Analysis
// ═══════════════════════════════════════════════════════════════════════════
function publish(board) {
  ANALYSIS.key = board.gameState.zobristKey;
  ANALYSIS.checkCount = checkCount;
  ANALYSIS.pinnedLo = pinnedLo; ANALYSIS.pinnedHi = pinnedHi;
  ANALYSIS.softLo = softLo;     ANALYSIS.softHi = softHi;
}

function analyze(board, us, them, ksq, occLo, occHi, ourLo, ourHi, theirLo, theirHi) {
  resetAnalysisState();
  if (ksq < 0) return;

  computeOpponentAttacks(board, them, ksq, occLo, occHi);
  computeCheckers(board, ksq, them, occLo, occHi);
  computeCheckMasks(board, ksq);
  if (checkCount >= 2) return;
  computePins(board, ksq, them, occLo, occHi, ourLo, ourHi, theirLo, theirHi);
}

function resetAnalysisState() {
  pinnedLo = 0; pinnedHi = 0;
  softLo = 0;   softHi = 0;
  checkLo = 0;  checkHi = 0;  checkCount = 0;
  capLo = FULL;  capHi = FULL;
  pushLo = FULL; pushHi = FULL;
  attLo = 0;     attHi = 0;
}

function computeOpponentAttacks(board, them, ksq, occLo, occHi) {
  computeAttackSet(board, them, occLo & ~bitLo(ksq), occHi & ~bitHi(ksq));
  attLo = ATTACKS.lo;
  attHi = ATTACKS.hi;
}

function computeCheckers(board, ksq, them, occLo, occHi) {
  attackersToSquare(board, ksq, them, occLo, occHi);
  checkLo = ATTACKERS.lo;
  checkHi = ATTACKERS.hi;
  checkCount = popCount64(checkLo, checkHi);
}

function computeCheckMasks(board, ksq) {
  if (checkCount === 0) return;                     // capLo/pushLo already FULL

  if (checkCount >= 2) {
    capLo = 0; capHi = 0; pushLo = 0; pushHi = 0;  // king moves only
    return;
  }

  // Single check: capture the checker, or block if it is a slider.
  capLo = checkLo;
  capHi = checkHi;

  const csq = lsb64(checkLo, checkHi);
  const cp = board.pieceList[csq];

  if (cp === PIECES.BISHOP || cp === PIECES.ROOK || cp === PIECES.QUEEN) {
    const i = (ksq << 6) | csq;
    pushLo = BTW_LO[i];
    pushHi = BTW_HI[i];
  } else {
    pushLo = 0;
    pushHi = 0;
  }
}

function computePins(board, ksq, them, occLo, occHi, ourLo, ourHi, theirLo, theirHi) {
  pinCandidates(board, ksq, them);
  const candLo = _pcLo;
  const candHi = _pcHi;

  for (let s = IT_SCAN.initRaw(candLo, candHi).next(); s >= 0; s = IT_SCAN.next()) {
    const i = (ksq << 6) | s;
    const bLo = BTW_LO[i] & occLo;
    const bHi = BTW_HI[i] & occHi;

    if ((bLo | bHi) === 0) continue;                       // direct checker, not pinner

    const lineLo = BTW_LO[i] | bitLo(s);
    const lineHi = BTW_HI[i] | bitHi(s);

    if (isSingleBit(bLo, bHi)) {
      recordAbsolutePin(bLo, bHi, lineLo, lineHi, ourLo, ourHi);
    } else if (popCount64(bLo, bHi) === 2) {
      recordSoftPin(bLo, bHi, lineLo, lineHi, ksq, s, ourLo, ourHi, theirLo, theirHi);
    }
    // ≥3 blockers: removing one still leaves two; nothing to record.
  }
}

function pinCandidates(board, ksq, them) {
  const tb = board.bbPieces[them];
  const rqLo = (tb[PIECES.ROOK].low  | tb[PIECES.QUEEN].low)  | 0;
  const rqHi = (tb[PIECES.ROOK].high | tb[PIECES.QUEEN].high) | 0;
  const bqLo = (tb[PIECES.BISHOP].low  | tb[PIECES.QUEEN].low)  | 0;
  const bqHi = (tb[PIECES.BISHOP].high | tb[PIECES.QUEEN].high) | 0;
  _pcLo = (RRAY_LO[ksq] & rqLo) | (BRAY_LO[ksq] & bqLo);
  _pcHi = (RRAY_HI[ksq] & rqHi) | (BRAY_HI[ksq] & bqHi);
}

function recordAbsolutePin(bLo, bHi, lineLo, lineHi, ourLo, ourHi) {
  if (((bLo & ourLo) | (bHi & ourHi)) === 0) return;    // enemy piece blocks — not our pin
  const p = lsb64(bLo, bHi);
  pinnedLo |= bLo;
  pinnedHi |= bHi;
  PIN_LO[p] = lineLo;
  PIN_HI[p] = lineHi;
}

function recordSoftPin(bLo, bHi, lineLo, lineHi, ksq, pinnerSq, ourLo, ourHi, theirLo, theirHi) {
  if (((bLo & theirLo) | (bHi & theirHi)) !== 0) return; // must both be ours

  let n = 0;
  for (let q = IT_PAIR.initRaw(bLo, bHi).next(); q >= 0; q = IT_PAIR.next()) SOFT_PAIR[n++] = q;

  const diag = ((ksq & 7) !== (pinnerSq & 7) && (ksq >> 3) !== (pinnerSq >> 3)) ? 1 : 0;

  for (let k = 0; k < 2; k++) {
    const q = SOFT_PAIR[k];
    SOFT_PARTNER[q] = SOFT_PAIR[k ^ 1];
    SOFT_LINE_LO[q] = lineLo;
    SOFT_LINE_HI[q] = lineHi;
    SOFT_DIAG[q] = diag;
  }
  softLo |= bLo;
  softHi |= bHi;
}

// ═══════════════════════════════════════════════════════════════════════════
// Emitters
// ═══════════════════════════════════════════════════════════════════════════
function emitTargets(slot, board, from, piece, tLo, tHi, theirLo, theirHi, withAlg) {
  for (let to = IT_TARGET.initRaw(tLo, tHi).next(); to >= 0; to = IT_TARGET.next()) {
    const cap = hasBit(theirLo, theirHi, to) ? board.pieceList[to] : null;
    emit(slot, from, to, piece, cap, false, null, withAlg);
  }
}

function emitKing(slot, board, ksq, ourLo, ourHi, theirLo, theirHi, quiets, withAlg) {
  if (ksq < 0) return;
  let tLo = KG_LO[ksq] & ~ourLo & ~attLo;
  let tHi = KG_HI[ksq] & ~ourHi & ~attHi;
  if (!quiets) { tLo &= theirLo; tHi &= theirHi; }
  emitTargets(slot, board, ksq, PIECES.KING, tLo, tHi, theirLo, theirHi, withAlg);
}

function emitKnights(slot, board, ourPieces, tgtLo, tgtHi, theirLo, theirHi, quiets, withAlg) {
  for (let from = IT_PIECE.init(ourPieces[PIECES.KNIGHT]).next(); from >= 0; from = IT_PIECE.next()) {
    // A knight's move never stays on a line, so a pinned knight is frozen.
    if (hasBit(pinnedLo, pinnedHi, from)) continue;
    let tLo = KN_LO[from] & tgtLo, tHi = KN_HI[from] & tgtHi;
    if (!quiets) { tLo &= theirLo; tHi &= theirHi; }
    emitTargets(slot, board, from, PIECES.KNIGHT, tLo, tHi, theirLo, theirHi, withAlg);
  }
}

function emitSliderType(slot, board, ourPieces, piece, tgtLo, tgtHi,
                        occLo, occHi, theirLo, theirHi, quiets, withAlg) {
  for (let from = IT_PIECE.init(ourPieces[piece]).next(); from >= 0; from = IT_PIECE.next()) {
    let aLo = 0, aHi = 0;
    if (piece !== PIECES.ROOK)   { bishopAttacks(from, occLo, occHi); aLo |= SLIDE.lo; aHi |= SLIDE.hi; }
    if (piece !== PIECES.BISHOP) { rookAttacks(from, occLo, occHi);   aLo |= SLIDE.lo; aHi |= SLIDE.hi; }

    let tLo = aLo & tgtLo, tHi = aHi & tgtHi;
    if (hasBit(pinnedLo, pinnedHi, from)) { tLo &= PIN_LO[from]; tHi &= PIN_HI[from]; }
    if (!quiets) { tLo &= theirLo; tHi &= theirHi; }
    emitTargets(slot, board, from, piece, tLo, tHi, theirLo, theirHi, withAlg);
  }
}

/**
 * The one pin the general framework cannot see.
 *
 *   8/8/8/8/k2pP2Q/8/8/4K3 b - e3
 *
 * Black king a4, white queen h4, black pawn d4, white pawn e4. BETWEEN(a4,h4)
 * holds TWO blockers, so neither pawn is pinned — correct, because moving the
 * d-pawn forward keeps the e-pawn on the rank. But dxe3 e.p. removes BOTH
 * blockers at once and hangs the king.
 *
 * Rather than teach the pin scanner about two-blocker lines (which would cost
 * something on every node), we pay the full slider test here. e.p. captures
 * are rare; this runs at most a handful of times per game tree branch.
 */
function epDiscoveryIsSafe(board, us, ksq, from, victim, to, occLo, occHi) {
  if (ksq < 0) return true;
  const oLo = (occLo & ~bitLo(from) & ~bitLo(victim)) | bitLo(to);
  const oHi = (occHi & ~bitHi(from) & ~bitHi(victim)) | bitHi(to);
  return !sliderAttacksKing(board, ksq, us ^ 1, oLo, oHi);
}

function emitPawns(slot, board, us, ksq, occLo, occHi, theirLo, theirHi, quiets, withAlg) {
  const white = us === WHITE_IDX;
  const pl = board.pieceList;
  const fwd = white ? 8 : -8;
  const startRank = white ? 1 : 6;
  const promoRank = white ? 7 : 0;
  const ep = board.gameState.enPassantSquare;
  const abase = us << 6;

  for (let from = IT_PIECE.init(board.bbPieces[us][PIECES.PAWN]).next(); from >= 0; from = IT_PIECE.next()) {
    const pinned = hasBit(pinnedLo, pinnedHi, from);
    const rayLo = pinned ? PIN_LO[from] : FULL;
    const rayHi = pinned ? PIN_HI[from] : FULL;

    // ── Pushes. A pawn never sits on the last rank, so `one` is always in range.
    const one = from + fwd;
    if (!hasBit(occLo, occHi, one)) {
      const promoting = (one >> 3) === promoRank;
      if ((quiets || promoting) && hasBit(pushLo & rayLo, pushHi & rayHi, one)) {
        addMove(slot, from, one, PIECES.PAWN, null, false, promoting, withAlg);
      }
      // Only the LANDING square needs to satisfy the push mask — a double push
      // passes over the intermediate square, it does not occupy it.
      if (quiets && (from >> 3) === startRank) {
        const two = one + fwd;
        if (!hasBit(occLo, occHi, two) && hasBit(pushLo & rayLo, pushHi & rayHi, two)) {
          addMove(slot, from, two, PIECES.PAWN, null, false, false, withAlg);
        }
      }
    }

    // ── Captures. LSB order reproduces the old (file-1, file+1) emission order.
    const aLo = PA_LO[abase | from], aHi = PA_HI[abase | from];
    const cLo = aLo & theirLo & capLo & rayLo;
    const cHi = aHi & theirHi & capHi & rayHi;
    for (let to = IT_TARGET.initRaw(cLo, cHi).next(); to >= 0; to = IT_TARGET.next()) {
      addMove(slot, from, to, PIECES.PAWN, pl[to], false, (to >> 3) === promoRank, withAlg);
    }

    // ── En passant. The destination square is empty, so it is in neither the
    //    capture mask nor (usually) the push mask. Two ways it can be legal
    //    while in check: it captures the checking pawn, or it blocks a slider.
    if (ep >= 0 && hasBit(aLo & rayLo, aHi & rayHi, ep)) {
      const victim = white ? ep - 8 : ep + 8;
      if (pl[victim] === PIECES.PAWN && hasBit(theirLo, theirHi, victim) &&
          (hasBit(capLo, capHi, victim) || hasBit(pushLo, pushHi, ep)) &&
          epDiscoveryIsSafe(board, us, ksq, from, victim, ep, occLo, occHi)) {
        // capturedPiece = PAWN so every "is this a capture?" test in ordering,
        // history and quiescence treats e.p. correctly.
        addMove(slot, from, ep, PIECES.PAWN, PIECES.PAWN, true, false, withAlg);
      }
    }
  }
}

function emitCastling(slot, board, color, ourLo, ourHi, withAlg) {
  const castling = board.gameState.castling;
  const backRank = color === 'white' ? 0 : 7;
  const base = backRank << 3;
  const kingFrom = base | 4;
  const pl = board.pieceList;

  if (pl[kingFrom] !== PIECES.KING || !hasBit(ourLo, ourHi, kingFrom)) return;

  const empty = f => pl[base | f] === PIECES.NONE;
  const safe  = s => !hasBit(attLo, attHi, s);
  const rook  = f => pl[base | f] === PIECES.ROOK && hasBit(ourLo, ourHi, base | f);

  // The caller guarantees we are not in check, so e1/e8 is already safe.
  // f1/g1 (and d1/c1) are on the king's rank: a slider reaching them *through*
  // the lifted king would have to be checking the king, so the king-removed
  // attack map is exact here.
  const kMask = color === 'white' ? CASTLING.WHITE_KINGSIDE : CASTLING.BLACK_KINGSIDE;
  if ((castling & kMask) !== 0 && empty(5) && empty(6) && rook(7) &&
      safe(base | 5) && safe(base | 6)) {
    addMove(slot, kingFrom, base | 6, PIECES.KING, null, false, false, withAlg);
  }

  const qMask = color === 'white' ? CASTLING.WHITE_QUEENSIDE : CASTLING.BLACK_QUEENSIDE;
  if ((castling & qMask) !== 0 && empty(1) && empty(2) && empty(3) && rook(0) &&
      safe(base | 3) && safe(base | 2)) {   // b1 needs only to be empty
    addMove(slot, kingFrom, base | 2, PIECES.KING, null, false, false, withAlg);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry point
// ═══════════════════════════════════════════════════════════════════════════
/**
 * @param {MoveSlot} slot          Target slot (pooled or fresh).
 * @param {boolean}  capturesOnly  Captures + promotions only. Ignored when in
 *                                 check — every evasion is mandatory.
 * @param {boolean}  withAlgebraic Populate `algebraic` (costs a string per move).
 * @returns {Array} slot.list — every entry is LEGAL.
 */
export function generateMoves(board, color, slot, capturesOnly = false, withAlgebraic = false) {
  slot.list.length = 0;

  const us = colorToIndex(color);
  const them = us ^ 1;
  const ourPieces = board.bbPieces[us];

  const ourLo   = board.bbSide[us].low   | 0, ourHi   = board.bbSide[us].high   | 0;
  const theirLo = board.bbSide[them].low | 0, theirHi = board.bbSide[them].high | 0;
  const occLo = ourLo | theirLo, occHi = ourHi | theirHi;

  const ksq = ourPieces[PIECES.KING].getLSB();

  analyze(board, us, them, ksq, occLo, occHi, ourLo, ourHi, theirLo, theirHi);
  publish(board);

  const inCheck = checkCount > 0;
  const quiets  = !capturesOnly || inCheck;

  if (checkCount >= 2) {
    emitKing(slot, board, ksq, ourLo, ourHi, theirLo, theirHi, quiets, withAlgebraic);
    if (__LOG__ && LOG.moves) {
      logger.trace(CAT.MOVES, 'gen', { color, n: slot.list.length, capturesOnly, check: checkCount });
    }
    return slot.list;
  }

  // Non-king pieces must resolve the check. A push-mask square is empty and the
  // capture-mask square is occupied, so the single OR is exact.
  const tgtLo = (capLo | pushLo) & ~ourLo;
  const tgtHi = (capHi | pushHi) & ~ourHi;

  emitPawns(slot, board, us, ksq, occLo, occHi, theirLo, theirHi, quiets, withAlgebraic);
  emitKnights(slot, board, ourPieces, tgtLo, tgtHi, theirLo, theirHi, quiets, withAlgebraic);
  emitSliderType(slot, board, ourPieces, PIECES.BISHOP, tgtLo, tgtHi, occLo, occHi, theirLo, theirHi, quiets, withAlgebraic);
  emitSliderType(slot, board, ourPieces, PIECES.ROOK,   tgtLo, tgtHi, occLo, occHi, theirLo, theirHi, quiets, withAlgebraic);
  emitSliderType(slot, board, ourPieces, PIECES.QUEEN,  tgtLo, tgtHi, occLo, occHi, theirLo, theirHi, quiets, withAlgebraic);
  emitKing(slot, board, ksq, ourLo, ourHi, theirLo, theirHi, quiets, withAlgebraic);

  if (quiets && !inCheck && ksq >= 0) {
    emitCastling(slot, board, color, ourLo, ourHi, withAlgebraic);
  }

  if (__LOG__ && LOG.moves) {
    logger.trace(CAT.MOVES, 'gen', { color, n: slot.list.length, capturesOnly, check: checkCount });
  }
  return slot.list;
}

// ═══════════════════════════════════════════════════════════════════════════
// Convenience wrappers — fresh slot, `algebraic` populated. UCI + tests only.
// ═══════════════════════════════════════════════════════════════════════════
export function generateAllLegalMoves(board, color) {
  return generateMoves(board, color, freshList(), false, true);
}

const HAS_MOVES_SLOT = freshList();
export function hasLegalMoves(board, color) {
  return generateMoves(board, color, HAS_MOVES_SLOT, false, false).length > 0;
}