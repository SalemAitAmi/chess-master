/**
 * Development evaluation heuristic - encourages piece development in opening
 */
import { PIECES } from '../core/constants.js';
import { colorToIndex, rowColToIndex, indexToRowCol } from '../core/bitboard.js';
import logger, { LOG } from '../logging/logger.js';

const __LOG__ = globalThis.__LOG__ ?? true;

// Hoisted out of the hot path: these were rebuilt as fresh arrays on every
// call to evaluateSideDevelopment (i.e. twice per evaluation).
const KNIGHT_STARTS = {
  white: [rowColToIndex(7, 1), rowColToIndex(7, 6)],
  black: [rowColToIndex(0, 1), rowColToIndex(0, 6)],
};
const BISHOP_STARTS = {
  white: [rowColToIndex(7, 2), rowColToIndex(7, 5)],
  black: [rowColToIndex(0, 2), rowColToIndex(0, 5)],
};

export function evaluateDevelopment(board, color, moveCount, weight = 1.0) {
  if (moveCount > 20) return 0;
  const oppositeColor = color === 'white' ? 'black' : 'white';
  const score = evaluateSideDevelopment(board, color, colorToIndex(color), moveCount)
              - evaluateSideDevelopment(board, oppositeColor, colorToIndex(oppositeColor), moveCount);
  const weighted = Math.round(score * weight);
  if (__LOG__ && LOG.heuristics) {
    logger.heuristics('trace', { h: 'development', c: color, s: weighted, moveCount }, `dev ${weighted}`);
  }
  return weighted;
}
function evaluateSideDevelopment(board, color, colorIdx, moveCount) {
  let score = 0;
  const backRank = color === 'white' ? 7 : 0;
  const knightStarts = KNIGHT_STARTS[color];
  const bishopStarts = BISHOP_STARTS[color];
  for (const sq of knightStarts) if (board.bbPieces[colorIdx][PIECES.KNIGHT].getBit(sq)) score -= 25;
  for (const sq of bishopStarts) if (board.bbPieces[colorIdx][PIECES.BISHOP].getBit(sq)) score -= 25;
  const kingSquare = board.bbPieces[colorIdx][PIECES.KING].getLSB();
  if (kingSquare !== -1) {
    const [kingRow, kingCol] = indexToRowCol(kingSquare);
    if (kingRow === backRank) {
      if (kingCol === 6 || kingCol === 2) score += 40;
      else if (kingCol === 4) score -= 15;
    }
  }
  const queenBB = board.bbPieces[colorIdx][PIECES.QUEEN];
  if (!queenBB.isEmpty() && moveCount < 8) {
    const [queenRow] = indexToRowCol(queenBB.getLSB());
    if (queenRow !== backRank) {
      let undeveloped = 0;
      for (const sq of knightStarts) if (board.bbPieces[colorIdx][PIECES.KNIGHT].getBit(sq)) undeveloped++;
      for (const sq of bishopStarts) if (board.bbPieces[colorIdx][PIECES.BISHOP].getBit(sq)) undeveloped++;
      if (undeveloped >= 2) score -= 30;
    }
  }
  return score;
}