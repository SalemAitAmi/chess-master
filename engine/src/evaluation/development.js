/**
 * Development evaluation heuristic - encourages piece development in opening
 */

import { PIECES } from '../core/constants.js';
import { colorToIndex, rowColToIndex, indexToRowCol } from '../core/bitboard.js';
import logger from '../logging/logger.js';

export function evaluateDevelopment(board, color, moveCount, weight = 1.0) {
  // Only significant in opening (first 20 moves)
  if (moveCount > 20) {
    return 0;
  }
  
  const colorIdx = colorToIndex(color);
  const oppositeColor = color === 'white' ? 'black' : 'white';
  const oppositeColorIdx = colorToIndex(oppositeColor);
  
  let score = 0;
  score += evaluateSideDevelopment(board, color, colorIdx, moveCount);
  score -= evaluateSideDevelopment(board, oppositeColor, oppositeColorIdx, moveCount);
  
  const weightedScore = Math.round(score * weight);
  
  logger.heuristicCalc('Development', color, weightedScore, { moveCount });
  
  return weightedScore;
}

function evaluateSideDevelopment(board, color, colorIdx, moveCount) {
  let score = 0;
  const backRank = color === 'white' ? 7 : 0;
  
  // Knight starting squares
  const knightStarts = color === 'white' 
    ? [rowColToIndex(7, 1), rowColToIndex(7, 6)]
    : [rowColToIndex(0, 1), rowColToIndex(0, 6)];
  
  for (const sq of knightStarts) {
    if (board.bbPieces[colorIdx][PIECES.KNIGHT].getBit(sq)) {
      score -= 25;
    }
  }
  
  // Bishop starting squares
  const bishopStarts = color === 'white'
    ? [rowColToIndex(7, 2), rowColToIndex(7, 5)]
    : [rowColToIndex(0, 2), rowColToIndex(0, 5)];
  
  for (const sq of bishopStarts) {
    if (board.bbPieces[colorIdx][PIECES.BISHOP].getBit(sq)) {
      score -= 25;
    }
  }
  
  // King position - castling bonus
  const kingBB = board.bbPieces[colorIdx][PIECES.KING];
  const kingSquare = kingBB.getLSB();
  if (kingSquare !== -1) {
    const [kingRow, kingCol] = indexToRowCol(kingSquare);
    if (kingRow === backRank) {
      if (kingCol === 6 || kingCol === 2) {
        score += 40; // Castled
      } else if (kingCol === 4) {
        score -= 15; // Still on starting square
      }
    }
  }
  
  // Queen out too early penalty
  const queenBB = board.bbPieces[colorIdx][PIECES.QUEEN];
  if (!queenBB.isEmpty()) {
    const queenSquare = queenBB.getLSB();
    const [queenRow] = indexToRowCol(queenSquare);
    const queenStartRow = color === 'white' ? 7 : 0;
    
    if (queenRow !== queenStartRow && moveCount < 8) {
      let undevelopedMinors = 0;
      for (const sq of [...knightStarts, ...bishopStarts]) {
        if (board.bbPieces[colorIdx][PIECES.KNIGHT].getBit(sq) ||
            board.bbPieces[colorIdx][PIECES.BISHOP].getBit(sq)) {
          undevelopedMinors++;
        }
      }
      if (undevelopedMinors >= 2) {
        score -= 30;
      }
    }
  }
  
  return score;
}