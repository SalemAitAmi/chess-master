/**
 * Center control evaluation heuristic
 */

import { PIECES } from '../core/constants.js';
import { colorToIndex, rowColToIndex } from '../core/bitboard.js';
import logger, { LOG, CAT } from '../logging/logger.js';
const __LOG__ = globalThis.__LOG__ ?? true;

const CENTER_SQUARES = [
  rowColToIndex(3, 3), rowColToIndex(3, 4), // d5, e5
  rowColToIndex(4, 3), rowColToIndex(4, 4)  // d4, e4
];

const EXTENDED_CENTER = [];
for (let row = 2; row <= 5; row++) {
  for (let col = 2; col <= 5; col++) {
    const sq = rowColToIndex(row, col);
    if (!CENTER_SQUARES.includes(sq)) {
      EXTENDED_CENTER.push(sq);
    }
  }
}

const PIECE_CENTER_BONUS = {
  [PIECES.PAWN]: 30,
  [PIECES.KNIGHT]: 20,
  [PIECES.BISHOP]: 15,
  [PIECES.ROOK]: 10,
  [PIECES.QUEEN]: 10,
  [PIECES.KING]: 0
};

export function evaluateCenterControl(board, color, weight = 1.0) {
  const colorIdx = colorToIndex(color);
  const oppIdx = colorIdx ^ 1;
  let score = 0;
  for (const sq of CENTER_SQUARES) {
    if (board.bbSide[colorIdx].getBit(sq)) score += PIECE_CENTER_BONUS[board.pieceList[sq]] ?? 10;
    else if (board.bbSide[oppIdx].getBit(sq)) score -= PIECE_CENTER_BONUS[board.pieceList[sq]] ?? 10;
  }
  for (const sq of EXTENDED_CENTER) {
    if (board.bbSide[colorIdx].getBit(sq)) score += 5;
    else if (board.bbSide[oppIdx].getBit(sq)) score -= 5;
  }
  const weighted = Math.round(score * weight);
  if (__LOG__ && LOG.heuristics) {
    logger.trace(CAT.HEURISTIC, 'centerControl', { h: 'centerControl', c: color, s: weighted , center: `center ${weighted}` });
  }
  return weighted;
}