/**
 * King safety evaluation heuristic
 */

import { PIECES } from '../core/constants.js';
import { colorToIndex, indexToRowCol } from '../core/bitboard.js';
import logger from '../logging/logger.js';

const PAWN_SHIELD_BONUS = 12;
const OPEN_FILE_NEAR_KING_PENALTY = 25;

export function evaluateKingSafety(board, color, endgameWeight, weight = 1.0) {
  // Less important in endgame
  const safetyWeight = Math.max(0.2, 1 - endgameWeight);
  
  const colorIdx = colorToIndex(color);
  const oppositeColor = color === 'white' ? 'black' : 'white';
  const oppositeColorIdx = colorToIndex(oppositeColor);
  
  let score = 0;
  score += evaluateKingSafetyForSide(board, color, colorIdx) * safetyWeight;
  score -= evaluateKingSafetyForSide(board, oppositeColor, oppositeColorIdx) * safetyWeight;
  
  const weightedScore = Math.round(score * weight);
  
  logger.heuristicCalc('KingSafety', color, weightedScore, { safetyWeight });
  
  return weightedScore;
}

function evaluateKingSafetyForSide(board, color, colorIdx) {
  const kingBB = board.bbPieces[colorIdx][PIECES.KING];
  const kingSquare = kingBB.getLSB();
  if (kingSquare === -1) return 0;
  
  const [kingRow, kingCol] = indexToRowCol(kingSquare);
  let safety = 0;
  
  const backRank = color === 'white' ? 7 : 0;
  const pawnRank = color === 'white' ? 6 : 1;
  
  // Pawn shield bonus
  if (kingRow === backRank && (kingCol <= 2 || kingCol >= 5)) {
    for (let col = Math.max(0, kingCol - 1); col <= Math.min(7, kingCol + 1); col++) {
      const rank = 7 - pawnRank;
      const shieldSquare = rank * 8 + col;
      if (board.bbPieces[colorIdx][PIECES.PAWN].getBit(shieldSquare)) {
        safety += PAWN_SHIELD_BONUS;
      }
    }
  }
  
  // Open file penalty
  for (let col = Math.max(0, kingCol - 1); col <= Math.min(7, kingCol + 1); col++) {
    let hasPawn = false;
    for (let row = 0; row < 8; row++) {
      const rank = 7 - row;
      const square = rank * 8 + col;
      if (board.bbPieces[colorIdx][PIECES.PAWN].getBit(square)) {
        hasPawn = true;
        break;
      }
    }
    if (!hasPawn) {
      safety -= OPEN_FILE_NEAR_KING_PENALTY;
    }
  }
  
  return safety;
}