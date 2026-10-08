/**
 * King safety.
 *
 * FILE CLASSIFICATION. A file beside the king is dangerous when the ENEMY's
 * heavy pieces can use it. The old test looked only for OUR pawn, so a king
 * sheltering among enemy pawns (which block the enemy's own rooks and queen)
 * paid the same as a king in the open. That is one half of "the king walks away
 * from the opposing pawns into the open and gets corralled"; the other half is
 * the mop-up term (see evaluate.js).
 *
 *   own pawn on file          → 0
 *   only enemy pawns          → ENEMY_PAWN_FILE_PENALTY  (storm lever, rooks blocked)
 *   no pawns at all           → OPEN_FILE_NEAR_KING_PENALTY
 *
 * COVER. A king that has LEFT its back rank has no shield term; pawns of either
 * colour on its ring block checking lines, so they are credited instead.
 */
import { PIECES } from '../core/constants.js';
import { colorToIndex, indexToRowCol, popCount64 } from '../core/bitboard.js';
import { KG_LO, KG_HI } from '../core/attacks.js';
import logger, { LOG, CAT } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;
const PAWN_SHIELD_BONUS = 12;
const OPEN_FILE_NEAR_KING_PENALTY = 25;
const ENEMY_PAWN_FILE_PENALTY = 10;
const MAX_FILE_PENALTY = 2 * OPEN_FILE_NEAR_KING_PENALTY;
const COVER_PAWN_BONUS = 6;
const MAX_COVER_PAWNS = 4;

const FILE_LO = new Int32Array(8), FILE_HI = new Int32Array(8);
for (let f = 0; f < 8; f++) {
  for (let r = 0; r < 8; r++) {
    const sq = (r << 3) | f;
    if (sq < 32) FILE_LO[f] |= (1 << sq); else FILE_HI[f] |= (1 << (sq - 32));
  }
}

function fileHasPawn(bb, col) {
  return ((bb.low & FILE_LO[col]) | (bb.high & FILE_HI[col])) !== 0;
}

export function evaluateKingSafety(board, color, endgameWeight, weight = 1.0) {
  const safetyWeight = Math.max(0.2, 1 - endgameWeight);
  const colorIdx = colorToIndex(color);
  const oppositeColor = color === 'white' ? 'black' : 'white';
  const score = (evaluateKingSafetyForSide(board, color, colorIdx, colorIdx ^ 1)
               - evaluateKingSafetyForSide(board, oppositeColor, colorIdx ^ 1, colorIdx)) * safetyWeight;
  const weighted = Math.round(score * weight);
  if (__LOG__ && LOG.heuristics) {
    logger.trace(CAT.HEURISTIC, 'king-safety', { c: color, s: weighted, sw: Math.round(safetyWeight * 100) });
  }
  return weighted;
}

/** 0 with no enemy queens/rooks, 1 with a queen plus a rook. */
function heavyPressure(board, attackerIdx) {
  const q = board.bbPieces[attackerIdx][PIECES.QUEEN].popCount();
  const r = board.bbPieces[attackerIdx][PIECES.ROOK].popCount();
  if (q === 0 && r === 0) return 0;
  return Math.min(1, (q * 2 + r) / 3);
}

function evaluateKingSafetyForSide(board, color, colorIdx, attackerIdx) {
  const kingSquare = board.bbPieces[colorIdx][PIECES.KING].getLSB();
  if (kingSquare === -1) return 0;
  
  const [kingRow, kingCol] = indexToRowCol(kingSquare);
  const backRank = color === 'white' ? 7 : 0;
  const pawnRank = color === 'white' ? 6 : 1;
  const ownPawns = board.bbPieces[colorIdx][PIECES.PAWN];
  const enemyPawns = board.bbPieces[attackerIdx][PIECES.PAWN];
  const pressure = heavyPressure(board, attackerIdx);
  let safety = 0;

  if (kingRow === backRank && (kingCol <= 2 || kingCol >= 5)) {
    const rank = 7 - pawnRank;
    let shield = 0;

    for (let col = Math.max(0, kingCol - 1); col <= Math.min(7, kingCol + 1); col++) {
      if (ownPawns.getBit(rank * 8 + col)) shield += PAWN_SHIELD_BONUS;
    }

    safety += Math.round(shield * (0.4 + 0.6 * pressure));
  }

  if (pressure > 0) {
    let filePenalty = 0;
    for (let col = Math.max(0, kingCol - 1); col <= Math.min(7, kingCol + 1); col++) {
      if (fileHasPawn(ownPawns, col)) continue;
      filePenalty += fileHasPawn(enemyPawns, col) ? ENEMY_PAWN_FILE_PENALTY : OPEN_FILE_NEAR_KING_PENALTY;
    }

    if (filePenalty > MAX_FILE_PENALTY) filePenalty = MAX_FILE_PENALTY;
    safety -= Math.round(filePenalty * pressure);

    if (kingRow !== backRank) {
      const allLo = (ownPawns.low | enemyPawns.low) | 0;
      const allHi = (ownPawns.high | enemyPawns.high) | 0;
      const cover = Math.min(MAX_COVER_PAWNS,
        popCount64(allLo & KG_LO[kingSquare], allHi & KG_HI[kingSquare]));
      safety += Math.round(cover * COVER_PAWN_BONUS * pressure);
    }
  }
  return safety;
}