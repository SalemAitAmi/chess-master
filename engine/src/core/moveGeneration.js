/**
 * Legal move generation and attack detection.
 *
 * Attack detection works BACKWARDS from the target square (pawn/knight/king
 * lookup tables plus eight sliding rays) with early exit and zero allocation.
 *
 * Move generation writes into a caller-supplied MoveSlot. The search passes a
 * pooled slot (one per ply, objects reused across nodes); everything else
 * passes a fresh slot. Square indices are rank*8 + file (a1 = 0).
 */
import { PIECES, CASTLING, WHITE_IDX } from './constants.js';
import { colorToIndex, indexToSquare } from './bitboard.js';
import logger, { LOG } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;

// ── Precomputed jump targets ──
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
// Attack detection
// ═══════════════════════════════════════════════════════════════════════════

export function isSquareAttacked(board, square, byColor) {
  const byIdx = colorToIndex(byColor);
  const bb = board.bbPieces[byIdx];
  const r = square >> 3, f = square & 7;

  // A white pawn on p attacks p+7 (file-1) and p+9 (file+1), so `square` is
  // attacked from square-9 / square-7. Mirrored for black.
  if (byIdx === WHITE_IDX) {
    if (r > 0) {
      if (f > 0 && bb[PIECES.PAWN].getBit(square - 9)) return true;
      if (f < 7 && bb[PIECES.PAWN].getBit(square - 7)) return true;
    }
  } else if (r < 7) {
    if (f < 7 && bb[PIECES.PAWN].getBit(square + 9)) return true;
    if (f > 0 && bb[PIECES.PAWN].getBit(square + 7)) return true;
  }

  const knights = bb[PIECES.KNIGHT];
  if (!knights.isEmpty()) {
    const t = KNIGHT_ATTACKS[square];
    for (let i = 0; i < t.length; i++) if (knights.getBit(t[i])) return true;
  }

  const kg = KING_ATTACKS[square];
  for (let i = 0; i < kg.length; i++) if (bb[PIECES.KING].getBit(kg[i])) return true;

  if (raySearch(board, r, f, ORTHO, byIdx, PIECES.ROOK))   return true;
  if (raySearch(board, r, f, DIAG,  byIdx, PIECES.BISHOP)) return true;
  return false;
}

function raySearch(board, r, f, dirs, byIdx, pieceType) {
  const pieceList = board.pieceList;
  const side = board.bbSide[byIdx];
  for (let d = 0; d < dirs.length; d++) {
    const dr = dirs[d][0], df = dirs[d][1];
    let nr = r + dr, nf = f + df;
    while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
      const sq = (nr << 3) | nf;
      const piece = pieceList[sq];
      if (piece !== PIECES.NONE) {
        if ((piece === pieceType || piece === PIECES.QUEEN) && side.getBit(sq)) return true;
        break;
      }
      nr += dr; nf += df;
    }
  }
  return false;
}

export function isInCheck(board, color) {
  const kingSquare = board.bbPieces[colorToIndex(color)][PIECES.KING].getLSB();
  if (kingSquare === -1) return false;
  return isSquareAttacked(board, kingSquare, color === 'white' ? 'black' : 'white');
}

// ═══════════════════════════════════════════════════════════════════════════
// Move slots
//
// A slot owns a permanent `objs` array of reusable move objects and a `list`
// array that references them. Generation resets `list` and refills it from
// `objs`, growing `objs` only when a node exceeds the high-water mark for its
// ply. Sorting reorders `list`; `objs` keeps every object alive.
//
// POOL is module-level and therefore shared by all SearchEngine instances.
// That is safe only because search is synchronous and single-threaded — two
// interleaved searches would clobber each other's lists.
// ═══════════════════════════════════════════════════════════════════════════

const POOL = new Array(256);

export function listForPly(ply) {
  if (ply >= 256) return freshList();   // check extensions beyond the pool
  let slot = POOL[ply];
  if (slot === undefined) slot = POOL[ply] = { objs: [], list: [] };
  return slot;
}

export function freshList() { return { objs: [], list: [] }; }

function blankMove() {
  // Fixed shape — V8 keeps one hidden class for every move object in the engine.
  return {
    fromSquare: 0, toSquare: 0, piece: PIECES.NONE,
    capturedPiece: null, isEnPassant: false,
    isPromotion: false, promotionPiece: null,
    algebraic: null,
    orderScore: 0, seeScore: 0,
    isTTMove: false, isKiller: false, isCounterMove: false, isBookMove: false,
  };
}

/** UCI move string for a move generated without `algebraic`. */
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
  // Reset annotations here rather than in orderMoves — a pooled object carries
  // flags from whatever node last used it.
  m.orderScore = 0; m.seeScore = 0;
  m.isTTMove = false; m.isKiller = false; m.isCounterMove = false; m.isBookMove = false;

  slot.list.push(m);
  return m;
}

// ═══════════════════════════════════════════════════════════════════════════
// Generation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {MoveSlot} slot          Target slot (pooled or fresh).
 * @param {boolean}  capturesOnly  Captures + promotions only. Ignored when in
 *                                 check — every evasion is mandatory.
 * @param {boolean}  withAlgebraic Populate `algebraic` (costs a string per move).
 * @returns {Array} slot.list
 */
export function generateMoves(board, color, slot, capturesOnly = false, withAlgebraic = false) {
  slot.list.length = 0;

  const colorIdx = colorToIndex(color);
  const oppIdx = colorIdx ^ 1;
  const pieces = board.bbPieces[colorIdx];
  const pieceList = board.pieceList;
  const ownSide = board.bbSide[colorIdx];
  const oppSide = board.bbSide[oppIdx];
  const quiets = !capturesOnly || isInCheck(board, color);

  const white = colorIdx === WHITE_IDX;
  const gs = board.gameState;

  // ── Pawns ──
  {
    const bb = pieces[PIECES.PAWN].clone();
    const fwd = white ? 8 : -8;
    const startRank = white ? 1 : 6;
    const promoRank = white ? 7 : 0;
    const epSquare = gs.enPassantSquare;

    while (!bb.isEmpty()) {
      const from = bb.popLSB();
      const f = from & 7, r = from >> 3;

      const one = from + fwd;
      if (one >= 0 && one < 64 && pieceList[one] === PIECES.NONE) {
        const promoting = (one >> 3) === promoRank;
        if (quiets || promoting) {
          addMove(board, slot, color, from, one, PIECES.PAWN, null, false, promoting, withAlgebraic);
        }
        if (quiets && r === startRank) {
          const two = one + fwd;
          if (pieceList[two] === PIECES.NONE) {
            addMove(board, slot, color, from, two, PIECES.PAWN, null, false, false, withAlgebraic);
          }
        }
      }

      // Captures: white from+7 (file-1) / from+9 (file+1); black mirrored.
      for (let k = 0; k < 2; k++) {
        const df = k === 0 ? -1 : 1;
        if ((df === -1 && f === 0) || (df === 1 && f === 7)) continue;
        const to = white ? from + 8 + df : from - 8 + df;
        if (to < 0 || to >= 64) continue;

        if (oppSide.getBit(to)) {
          addMove(board, slot, color, from, to, PIECES.PAWN, pieceList[to], false,
                  (to >> 3) === promoRank, withAlgebraic);
        } else if (to === epSquare) {
          const victim = white ? to - 8 : to + 8;
          if (pieceList[victim] === PIECES.PAWN && oppSide.getBit(victim)) {
            // capturedPiece = PAWN so every "is this a capture?" test in
            // ordering, history and quiescence treats e.p. correctly.
            addMove(board, slot, color, from, to, PIECES.PAWN, PIECES.PAWN, true, false, withAlgebraic);
          }
        }
      }
    }
  }

  // ── Knights ──
  emitJumps(board, slot, color, pieces[PIECES.KNIGHT], PIECES.KNIGHT, KNIGHT_ATTACKS,
            ownSide, oppSide, pieceList, quiets, withAlgebraic);

  // ── Sliders ──
  emitSliders(board, slot, color, pieces[PIECES.BISHOP], PIECES.BISHOP, DIAG,
              ownSide, oppSide, pieceList, quiets, withAlgebraic);
  emitSliders(board, slot, color, pieces[PIECES.ROOK], PIECES.ROOK, ORTHO,
              ownSide, oppSide, pieceList, quiets, withAlgebraic);
  emitSliders(board, slot, color, pieces[PIECES.QUEEN], PIECES.QUEEN, ORTHO,
              ownSide, oppSide, pieceList, quiets, withAlgebraic);
  emitSliders(board, slot, color, pieces[PIECES.QUEEN], PIECES.QUEEN, DIAG,
              ownSide, oppSide, pieceList, quiets, withAlgebraic);

  // ── King ──
  emitJumps(board, slot, color, pieces[PIECES.KING], PIECES.KING, KING_ATTACKS,
            ownSide, oppSide, pieceList, quiets, withAlgebraic);

  if (quiets) emitCastling(board, slot, color, colorIdx, pieceList, withAlgebraic);

  if (__LOG__ && LOG.moves) {
    logger.moves('debug', { color, moveCount: slot.list.length, capturesOnly },
                 `Generated ${slot.list.length} moves`);
  }
  return slot.list;
}

function emitJumps(board, slot, color, bb0, piece, table, ownSide, oppSide, pieceList, quiets, withAlg) {
  const bb = bb0.clone();
  while (!bb.isEmpty()) {
    const from = bb.popLSB();
    const t = table[from];
    for (let i = 0; i < t.length; i++) {
      const to = t[i];
      if (ownSide.getBit(to)) continue;
      const isCap = oppSide.getBit(to);
      if (!isCap && !quiets) continue;
      addMove(board, slot, color, from, to, piece, isCap ? pieceList[to] : null, false, false, withAlg);
    }
  }
}

function emitSliders(board, slot, color, bb0, piece, dirs, ownSide, oppSide, pieceList, quiets, withAlg) {
  const bb = bb0.clone();
  while (!bb.isEmpty()) {
    const from = bb.popLSB();
    const r = from >> 3, f = from & 7;
    for (let d = 0; d < dirs.length; d++) {
      const dr = dirs[d][0], df = dirs[d][1];
      let nr = r + dr, nf = f + df;
      while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
        const to = (nr << 3) | nf;
        if (ownSide.getBit(to)) break;
        if (oppSide.getBit(to)) {
          addMove(board, slot, color, from, to, piece, pieceList[to], false, false, withAlg);
          break;
        }
        if (quiets) addMove(board, slot, color, from, to, piece, null, false, false, withAlg);
        nr += dr; nf += df;
      }
    }
  }
}

function emitCastling(board, slot, color, colorIdx, pieceList, withAlg) {
  const castling = board.gameState.castling;
  const backRank = color === 'white' ? 0 : 7;   // rank index: white = rank 1
  const kingFrom = (backRank << 3) | 4;
  if (board.pieceList[kingFrom] !== PIECES.KING) return;
  if (!board.bbPieces[colorIdx][PIECES.KING].getBit(kingFrom)) return;
  if (isInCheck(board, color)) return;

  const opp = color === 'white' ? 'black' : 'white';
  const empty = file => pieceList[(backRank << 3) | file] === PIECES.NONE;

  const kMask = color === 'white' ? CASTLING.WHITE_KINGSIDE : CASTLING.BLACK_KINGSIDE;
  if ((castling & kMask) !== 0 && empty(5) && empty(6) &&
      !isSquareAttacked(board, (backRank << 3) | 5, opp)) {
    addMove(board, slot, color, kingFrom, (backRank << 3) | 6, PIECES.KING, null, false, false, withAlg);
  }
  const qMask = color === 'white' ? CASTLING.WHITE_QUEENSIDE : CASTLING.BLACK_QUEENSIDE;
  if ((castling & qMask) !== 0 && empty(1) && empty(2) && empty(3) &&
      !isSquareAttacked(board, (backRank << 3) | 3, opp)) {
    addMove(board, slot, color, kingFrom, (backRank << 3) | 2, PIECES.KING, null, false, false, withAlg);
  }
}

/**
 * Legality-test once per (from,to), then emit. Promotions fan out to four
 * entries sharing that single test — the old code ran make/unmake four times
 * for the same pawn move.
 */
function addMove(board, slot, color, from, to, piece, captured, isEnPassant, promoting, withAlg) {
  board.makeMove(from, to);
  const legal = !isInCheck(board, color);
  board.undoMove();
  if (!legal) return;

  if (promoting) {
    for (let i = 0; i < PROMO_ORDER.length; i++) {
      emit(slot, from, to, piece, captured, false, PROMO_ORDER[i], withAlg);
    }
  } else {
    emit(slot, from, to, piece, captured, isEnPassant, null, withAlg);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Convenience wrappers — allocate a fresh slot, populate `algebraic`.
// Used by the UCI handler and tests; never by the search hot path.
// ═══════════════════════════════════════════════════════════════════════════

export function generateAllLegalMoves(board, color) {
  return generateMoves(board, color, freshList(), false, true);
}

const HAS_MOVES_SLOT = freshList();
export function hasLegalMoves(board, color) {
  // Dedicated slot so this never disturbs a pooled list mid-search.
  return generateMoves(board, color, HAS_MOVES_SLOT, false, false).length > 0;
}