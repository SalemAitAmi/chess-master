/**
 * Center control evaluation heuristic
 */

import { PIECES } from '../core/constants.js';
import { colorToIndex, rowColToIndex } from '../core/bitboard.js';
import logger from '../logging/logger.js';

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
  const oppositeColorIdx = colorToIndex(color === 'white' ? 'black' : 'white');
  
  let score = 0;
  const details = { centerSquares: [], extendedCenter: [] };
  
  // Center squares
  for (const sq of CENTER_SQUARES) {
    if (board.bbSide[colorIdx].getBit(sq)) {
      const piece = board.pieceList[sq];
      const bonus = PIECE_CENTER_BONUS[piece] || 10;
      score += bonus;
      details.centerSquares.push({ square: sq, piece, bonus });
    }
    if (board.bbSide[oppositeColorIdx].getBit(sq)) {
      const piece = board.pieceList[sq];
      const penalty = PIECE_CENTER_BONUS[piece] || 10;
      score -= penalty;
    }
  }
  
  // Extended center
  for (const sq of EXTENDED_CENTER) {
    if (board.bbSide[colorIdx].getBit(sq)) {
      score += 5;
      details.extendedCenter.push(sq);
    }
    if (board.bbSide[oppositeColorIdx].getBit(sq)) {
      score -= 5;
    }
  }
  
  const weightedScore = Math.round(score * weight);
  
  logger.heuristicCalc('CenterControl', color, weightedScore, details);
  
  return weightedScore;
}