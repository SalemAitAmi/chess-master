/**
 * King safety evaluation heuristic
 */

import { PIECES } from '../core/constants.js';
import { colorToIndex, indexToRowCol } from '../core/bitboard.js';
import logger, { LOG, CAT } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;

const PAWN_SHIELD_BONUS = 12;
const OPEN_FILE_NEAR_KING_PENALTY = 25;

export function evaluateKingSafety(board, color, endgameWeight, weight = 1.0) {
  const safetyWeight = Math.max(0.2, 1 - endgameWeight);
  const colorIdx = colorToIndex(color);
  const oppositeColor = color === 'white' ? 'black' : 'white';

  const score = (evaluateKingSafetyForSide(board, color, colorIdx, colorIdx ^ 1)
               - evaluateKingSafetyForSide(board, oppositeColor, colorIdx ^ 1, colorIdx)) * safetyWeight;

  const weighted = Math.round(score * weight);
  if (__LOG__ && LOG.heuristics) {
    logger.trace(CAT.HEURISTIC, 'king-safety', { c: color, s: weighted, safetyWeight });
  }
  return weighted;
}

/**
 * How much heavy-piece pressure the opponent can actually bring to an open
 * file: 0 with no queens or rooks, 1 with a queen plus a rook.
 *
 * Without this, the open-file penalty was a constant that only decayed via the
 * phase-scaled safetyWeight. Since trading queens drops gamePhase by 1/3 in a
 * single ply, a side with a half-open king file could erase ~25cp of its own
 * penalty just by trading queens — a standing, position-independent incentive
 * to trade that showed up as bots liquidating queens at every opportunity.
 */
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
  const pawns = board.bbPieces[colorIdx][PIECES.PAWN];
  let safety = 0;

  if (kingRow === backRank && (kingCol <= 2 || kingCol >= 5)) {
    const rank = 7 - pawnRank;
    for (let col = Math.max(0, kingCol - 1); col <= Math.min(7, kingCol + 1); col++) {
      if (pawns.getBit(rank * 8 + col)) safety += PAWN_SHIELD_BONUS;
    }
  }

  const pressure = heavyPressure(board, attackerIdx);
  if (pressure > 0) {
    let openFiles = 0;
    for (let col = Math.max(0, kingCol - 1); col <= Math.min(7, kingCol + 1); col++) {
      let hasPawn = false;
      for (let row = 0; row < 8; row++) {
        if (pawns.getBit((7 - row) * 8 + col)) { hasPawn = true; break; }
      }
      if (!hasPawn) openFiles++;
    }
    safety -= Math.round(openFiles * OPEN_FILE_NEAR_KING_PENALTY * pressure);
  }

  return safety;
}